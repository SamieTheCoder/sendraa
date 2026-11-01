import type { TransactionSql } from 'postgres';

const SUBJECT_FALLBACK_WINDOW = '30 days';

export interface ThreadInput {
  mailboxId: string;
  inReplyTo: string | null;
  references: string[];
  subjectNorm: string;
  participants: string[];
  at: Date;
}

/**
 * Finds or creates the thread a message belongs to.
 *
 * Strategy mirrors what mail clients do in practice:
 *  1. Follow In-Reply-To / References to a message we already store. This is
 *     authoritative and handles subject changes mid-thread.
 *  2. Fall back to a normalised-subject match inside a recent window, since
 *     plenty of senders (and most mobile clients) omit threading headers.
 *  3. Otherwise start a new thread.
 */
export async function resolveThread(
  tx: TransactionSql<{}>,
  input: ThreadInput,
): Promise<string> {
  const candidates = [input.inReplyTo, ...input.references].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );

  if (candidates.length > 0) {
    const found = await tx<{ thread_id: string | null }[]>`
      select thread_id
      from messages
      where mailbox_id = ${input.mailboxId}
        and rfc_message_id = any(${candidates})
        and thread_id is not null
      order by created_at desc
      limit 1
    `;
    const threadId = found[0]?.thread_id;
    if (threadId) return bump(tx, threadId, input);
  }

  if (input.subjectNorm) {
    const found = await tx<{ id: string }[]>`
      select id
      from threads
      where mailbox_id = ${input.mailboxId}
        and subject_norm = ${input.subjectNorm}
        and last_message_at > now() - ${SUBJECT_FALLBACK_WINDOW}::interval
      order by last_message_at desc
      limit 1
    `;
    const threadId = found[0]?.id;
    if (threadId) return bump(tx, threadId, input);
  }

  const created = await tx<{ id: string }[]>`
    insert into threads (mailbox_id, subject_norm, last_message_at, message_count, participants)
    values (${input.mailboxId}, ${input.subjectNorm}, ${input.at}, 1, ${input.participants})
    returning id
  `;

  const id = created[0]?.id;
  if (!id) throw new Error('failed to create thread');
  return id;
}

/** Updates thread rollups, keeping participants unioned and ordered by recency. */
async function bump(
  tx: TransactionSql<{}>,
  threadId: string,
  input: ThreadInput,
): Promise<string> {
  await tx`
    update threads
    set message_count = message_count + 1,
        last_message_at = greatest(last_message_at, ${input.at}),
        participants = (
          select array_agg(distinct p)
          from unnest(participants || ${input.participants}::citext[]) as p
        )
    where id = ${threadId}
  `;
  return threadId;
}
