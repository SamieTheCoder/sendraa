import { readFileSync } from 'node:fs';
import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import { env } from '../env.js';
import { sql } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { isBlocked, resolveRecipient, type ResolvedRecipient } from './routing.js';
import { storeInbound } from './store.js';

/**
 * Session state we accumulate across the SMTP conversation.
 *
 * Recipients are resolved during RCPT TO rather than at DATA so that unknown
 * addresses are refused while the sender is still on the wire, which is what
 * lets the sending MTA generate its own bounce instead of us emitting one.
 */
interface SessionState {
  recipients: ResolvedRecipient[];
}

const sessions = new WeakMap<SMTPServerSession, SessionState>();

function stateFor(session: SMTPServerSession): SessionState {
  let s = sessions.get(session);
  if (!s) {
    s = { recipients: [] };
    sessions.set(session, s);
  }
  return s;
}

export function createSmtpServer(): SMTPServer {
  const tls =
    env.SMTP_TLS_KEY_PATH && env.SMTP_TLS_CERT_PATH
      ? {
          key: readFileSync(env.SMTP_TLS_KEY_PATH),
          cert: readFileSync(env.SMTP_TLS_CERT_PATH),
        }
      : {};

  if (!env.SMTP_TLS_KEY_PATH) {
    logger.warn(
      'STARTTLS is not configured; inbound mail will be accepted in cleartext. ' +
        'Set SMTP_TLS_KEY_PATH and SMTP_TLS_CERT_PATH before serving real tenants.',
    );
  }

  const server = new SMTPServer({
    name: env.SMTP_HOSTNAME,
    banner: env.SMTP_BANNER,
    size: env.MAX_MESSAGE_BYTES,

    // This is a public MX. Remote senders are anonymous by definition, so AUTH
    // is disabled rather than optional. The control that stops this becoming an
    // open relay is onRcptTo: we accept recipients only for verified domains we
    // host, and this process never performs onward delivery.
    authOptional: true,
    disabledCommands: ['AUTH'],
    hideSTARTTLS: !env.SMTP_TLS_KEY_PATH,
    ...tls,

    onMailFrom(address, session, callback) {
      stateFor(session).recipients = [];
      logger.debug({ from: address.address, ip: session.remoteAddress }, 'MAIL FROM');
      callback();
    },

    onRcptTo(address, session, callback) {
      void (async () => {
        try {
          const resolved = await resolveRecipient(address.address);

          if (!resolved) {
            await recordFailure(address.address, session, 'unknown recipient');
            // 550 is permanent: tells the sender to stop retrying and bounce.
            return callback(
              Object.assign(new Error('551 Relay denied: recipient not hosted here'), {
                responseCode: 550,
              }),
            );
          }

          if (await isBlocked(resolved.mailboxId, session.envelope.mailFrom ? session.envelope.mailFrom.address : '')) {
            await recordFailure(address.address, session, 'sender blocked');
            return callback(
              Object.assign(new Error('550 Sender blocked by recipient'), {
                responseCode: 550,
              }),
            );
          }

          const state = stateFor(session);
          if (!state.recipients.some((r) => r.mailboxId === resolved.mailboxId)) {
            state.recipients.push(resolved);
          }
          callback();
        } catch (err) {
          logger.error({ err, rcpt: address.address }, 'RCPT TO failed');
          // 451 is transient so the sender retries rather than bouncing on
          // what is almost certainly our own database being briefly unavailable.
          callback(
            Object.assign(new Error('451 Temporary failure, please retry'), {
              responseCode: 451,
            }),
          );
        }
      })();
    },

    onData(stream, session, callback) {
      void (async () => {
        const chunks: Buffer[] = [];
        let size = 0;
        let exceeded = false;

        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > env.MAX_MESSAGE_BYTES) {
            exceeded = true;
            return;
          }
          chunks.push(chunk);
        });

        stream.on('end', () => {
          void (async () => {
            if (exceeded) {
              logger.warn({ size }, 'message exceeded size limit');
              return callback(
                Object.assign(new Error('552 Message exceeds maximum size'), {
                  responseCode: 552,
                }),
              );
            }

            const raw = Buffer.concat(chunks);
            const state = stateFor(session);
            const envelopeFrom = session.envelope.mailFrom ? session.envelope.mailFrom.address : '';

            try {
              let stored = 0;
              for (const recipient of state.recipients) {
                const result = await storeInbound({
                  recipient,
                  envelopeFrom,
                  clientIp: session.remoteAddress,
                  raw,
                });
                if (!result.duplicate) stored += 1;
              }

              logger.info(
                {
                  from: envelopeFrom,
                  recipients: state.recipients.length,
                  stored,
                  bytes: raw.byteLength,
                },
                'message accepted',
              );
              callback();
            } catch (err) {
              logger.error({ err, from: envelopeFrom }, 'failed to store message');
              // Transient so the sender retries; the message is not lost.
              callback(
                Object.assign(new Error('451 Temporary failure storing message'), {
                  responseCode: 451,
                }),
              );
            }
          })();
        });

        stream.on('error', (err) => {
          logger.error({ err }, 'inbound stream error');
          callback(
            Object.assign(new Error('451 Stream error'), { responseCode: 451 }),
          );
        });
      })();
    },

  });
  server.on('error', (err) => logger.error({ err }, 'smtp server error'));
  return server;
}

async function recordFailure(
  rcpt: string,
  session: SMTPServerSession,
  reason: string,
): Promise<void> {
  try {
    await sql`
      insert into ingest_failures (envelope_from, envelope_to, client_ip, reason)
      values (
        ${session.envelope.mailFrom ? session.envelope.mailFrom.address : null},
        ${rcpt},
        ${session.remoteAddress || null},
        ${reason}
      )
    `;
  } catch (err) {
    logger.warn({ err }, 'could not record ingest failure');
  }
}
