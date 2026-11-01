import { env } from '../env.js';
import { closeDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { createSmtpServer } from './smtp.js';

const server = createSmtpServer();

server.listen(env.SMTP_PORT, env.SMTP_HOST, () => {
  logger.info(
    { port: env.SMTP_PORT, host: env.SMTP_HOST, hostname: env.SMTP_HOSTNAME },
    'sendraa smtp ingest listening',
  );
});

// Drain in-flight SMTP conversations before exiting so a deploy does not
// bounce mail that is mid-delivery.
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
