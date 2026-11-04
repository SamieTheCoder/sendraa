/** Delete only this mailbox's data. Bounded, resumable across requests/failures. */
export async function deleteMailbox(env: Env, mailboxId: string): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare('insert or ignore into mailbox_deletions(mailbox_id,created_at) values(?,?)').bind(mailboxId, Date.now()),
    env.DB.prepare('insert or ignore into mailbox_cleanup select mailbox_id,raw_key from messages where mailbox_id=?').bind(mailboxId),
    env.DB.prepare('insert or ignore into mailbox_cleanup select m.mailbox_id,a.r2_key from attachments a join messages m on m.id=a.message_id where m.mailbox_id=?').bind(mailboxId),
    // FK cascades delete messages, threads, and attachment metadata together.
    env.DB.prepare('delete from mailboxes where id=?').bind(mailboxId),
  ]);
  const objects = await env.DB.prepare('select object_key from mailbox_cleanup where mailbox_id=? limit 100').bind(mailboxId).all<{object_key:string}>();
  if (objects.results.length) {
    await env.BLOB.delete(objects.results.map((r) => r.object_key));
    await env.DB.batch(objects.results.map((r) => env.DB.prepare('delete from mailbox_cleanup where mailbox_id=? and object_key=?').bind(mailboxId,r.object_key)));
    return Response.json({ done: false }, { status: 202 });
  }
  // Include unfinished uploads which never reached a message record.
  for (const prefix of [`raw/${mailboxId}/`, `outbound/${mailboxId}/`]) {
    const page = await env.BLOB.list({ prefix, limit: 100 });
    if (page.objects.length) {
      await env.BLOB.delete(page.objects.map((object) => object.key));
      return Response.json({ done: false }, { status: 202 });
    }
  }
  return Response.json({ done: true });
}
