/** Outbound copies are already parsed by the platform. No SMTP or user policy in this Worker. */
type Addr = { name: string; address: string };
type Copy = { from: Addr; to: Addr[]; cc: Addr[]; subject: string; text: string; date: string; messageId: string;
  threadId: string | null; inReplyTo: string | null; references: string[]; rawSize: number;
  attachments: { name: string; type: string; size: number }[] };
const key = (mid: string, id: string, part: string) => `outbound/${mid}/${id}/${part}`;

export async function putOutboundObject(request: Request, env: Env, mid: string, id: string, part: string) {
  const exists = await env.DB.prepare('select id from mailboxes where id=?').bind(mid).first();
  if (!exists) return Response.json({ error: { message: 'Mailbox not found.' } }, { status: 404 });
  // Count actual bytes too, even when a caller omits or misstates Content-Length.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > 25 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: { message: 'Object too large.' } }, { status: 413 }); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  await env.BLOB.put(key(mid, id, part), bytes);
  if (!await env.DB.prepare('select id from mailboxes where id=?').bind(mid).first()) {
    await env.BLOB.delete(key(mid,id,part));
    return Response.json({ error: { message: 'Mailbox was deleted.' } }, { status: 409 });
  }
  return Response.json({ ok: true });
}

export async function storeOutbound(body: Record<string, unknown>, env: Env, mid: string, id: string) {
  const existing = await env.DB.prepare('select thread_id from messages where id=? and mailbox_id=?').bind(id, mid).first<{ thread_id: string }>();
  if (existing) return Response.json({ threadId: existing.thread_id });
  // Only the authenticated platform sends this contract; reject malformed bodies before writes.
  const isAddr = (v: unknown): v is Addr => !!v && typeof v === 'object' && 'address' in v && typeof v.address === 'string' && 'name' in v && typeof v.name === 'string';
  if (!isAddr(body.from) || !Array.isArray(body.to) || !body.to.every(isAddr) || !Array.isArray(body.cc) || !body.cc.every(isAddr)
    || typeof body.subject !== 'string' || typeof body.text !== 'string' || typeof body.date !== 'string' || !Number.isFinite(Date.parse(body.date))
    || typeof body.messageId !== 'string' || !Array.isArray(body.references) || !body.references.every((v) => typeof v === 'string')
    || (body.threadId !== null && (typeof body.threadId !== 'string' || !/^[\w-]{1,64}$/.test(body.threadId)))
    || (body.inReplyTo !== null && typeof body.inReplyTo !== 'string') || typeof body.rawSize !== 'number'
    || !Array.isArray(body.attachments) || body.attachments.length > 20 || !body.attachments.every((v) => v && typeof v.name === 'string' && typeof v.type === 'string' && Number.isSafeInteger(v.size) && v.size >= 0)) {
    return Response.json({ error: { message: 'Invalid outbound copy.' } }, { status: 400 });
  }
  const mail = body as Copy;
  const mailbox = await env.DB.prepare('select address from mailboxes where id=?').bind(mid).first<{ address: string }>();
  if (!mailbox || mailbox.address !== mail.from.address) return Response.json({ error: { message: 'Mailbox mismatch.' } }, { status: 400 });
  const rawKey = key(mid, id, 'raw');
  const raw = await env.BLOB.head(rawKey);
  if (!raw || raw.size !== mail.rawSize) return Response.json({ error: { message: 'Raw message missing.' } }, { status: 409 });
  for (const [i, a] of mail.attachments.entries()) {
    const object = await env.BLOB.head(key(mid, id, `att-${i}`));
    if (!object || object.size !== a.size) return Response.json({ error: { message: 'Attachment missing.' } }, { status: 409 });
  }
  const threadId = mail.threadId ?? id;
  const thread = await env.DB.prepare('select id,participants from threads where id=? and mailbox_id=?').bind(threadId, mid).first<{ id: string; participants: string }>();
  if (mail.threadId && !thread) return Response.json({ error: { message: 'Thread not found in mailbox.' } }, { status: 404 });
  const participants: Addr[] = thread ? JSON.parse(thread.participants) : [];
  for (const a of [...mail.to, ...mail.cc, mail.from]) if (!participants.some((p) => p.address === a.address)) participants.push(a);
  const snippet = mail.text.replace(/\s+/g, ' ').slice(0, 200); const date = Date.parse(mail.date);
  const strip = (s: string) => s.replace(/^<|>$/g, '');
  const statements: D1PreparedStatement[] = [];
  if (!thread) statements.push(env.DB.prepare(`insert into threads(id,mailbox_id,subject,location,unread,last_message_at) values(?,?,?,'sent',0,?) on conflict(id) do nothing`).bind(threadId,mid,mail.subject,date));
  statements.push(env.DB.prepare(`insert into messages(id,thread_id,mailbox_id,message_id,in_reply_to,refs,envelope_from,from_addr,to_addrs,cc_addrs,subject,snippet,text_body,sent_at,received_at,raw_key,raw_size,direction)
    values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'out') on conflict(id) do nothing`).bind(id,threadId,mid,strip(mail.messageId),mail.inReplyTo ? strip(mail.inReplyTo) : null,JSON.stringify(mail.references.map(strip)),mail.from.address,JSON.stringify(mail.from),JSON.stringify(mail.to),JSON.stringify(mail.cc),mail.subject,snippet,mail.text,date,date,rawKey,mail.rawSize));
  for (const [i,a] of mail.attachments.entries()) statements.push(env.DB.prepare('insert into attachments(id,message_id,filename,content_type,size,r2_key) values(?,?,?,?,?,?) on conflict(id) do nothing').bind(`${id}-${i}`,id,a.name,a.type,a.size,key(mid,id,`att-${i}`)));
  // Derived count keeps concurrent/replayed copy requests from incrementing twice.
  statements.push(env.DB.prepare(`update threads set message_count=(select count(*) from messages where thread_id=?),
    snippet=case when last_message_at <= ? then ? else snippet end, participants=?,
    has_attachments=max(has_attachments,?), last_message_at=max(last_message_at,?) where id=? and mailbox_id=?`)
    .bind(threadId,date,snippet,JSON.stringify(participants.slice(-20)),mail.attachments.length ? 1 : 0,date,threadId,mid));
  await env.DB.batch(statements);
  return Response.json({ threadId });
}
