type Attachment = { name:string; type:string; size:number; contentId:string|null; inline:boolean };
type Parsed = { text:string|null; html:string|null; attachments:Attachment[] };

/** The platform parses MIME; this Worker only validates and stores the result. */
export async function storeParsedMessage(env:Env, mailboxId:string, messageId:string, body:Record<string,unknown>) {
  const row=await env.DB.prepare('select thread_id,needs_parse from messages where id=? and mailbox_id=?').bind(messageId,mailboxId).first<{thread_id:string;needs_parse:number}>();
  if(!row)return Response.json({error:{message:'Message not found.'}},{status:404});
  if(!row.needs_parse)return Response.json({ok:true});
  if((body.text!==null&&typeof body.text!=='string')||(body.html!==null&&typeof body.html!=='string')||!Array.isArray(body.attachments)||body.attachments.length>50||!body.attachments.every((a)=>a&&typeof a.name==='string'&&a.name.length<=512&&typeof a.type==='string'&&a.type.length<=128&&Number.isSafeInteger(a.size)&&a.size>=0&&(a.contentId===null||typeof a.contentId==='string')&&typeof a.inline==='boolean'))return Response.json({error:{message:'Invalid parsed message.'}},{status:400});
  const parsed=body as Parsed;
  if(new TextEncoder().encode((parsed.text??'')+(parsed.html??'')).length>1024*1024)return Response.json({error:{message:'Message text is too large.'}},{status:413});
  const key=(i:number)=>`outbound/${mailboxId}/parse-${messageId}/att-${i}`;
  for(const [i,a] of parsed.attachments.entries()) {
    const stored=await env.BLOB.head(key(i));
    if(!stored||stored.size!==a.size)return Response.json({error:{message:'Attachment upload incomplete.'}},{status:409});
  }
  const snippet=(parsed.text??parsed.html?.replace(/<[^>]+>/g,' ')??'').replace(/\s+/g,' ').slice(0,200);
  const statements=[env.DB.prepare('delete from attachments where message_id=? and exists(select 1 from messages where id=? and mailbox_id=? and needs_parse=1)').bind(messageId,messageId,mailboxId)];
  for(const [i,a] of parsed.attachments.entries())statements.push(env.DB.prepare(`insert into attachments(id,message_id,filename,content_type,size,content_id,inline,r2_key)
    select ?,id,?,?,?,?,?,? from messages where id=? and mailbox_id=? and needs_parse=1`).bind(`${messageId}-parsed-${i}`,a.name,a.type,a.size,a.contentId,a.inline?1:0,key(i),messageId,mailboxId));
  statements.push(env.DB.prepare('update messages set text_body=?,html_body=?,snippet=?,needs_parse=0 where id=? and mailbox_id=? and needs_parse=1').bind(parsed.text,parsed.html,snippet,messageId,mailboxId));
  statements.push(env.DB.prepare(`update threads set has_attachments=exists(select 1 from attachments a join messages m on m.id=a.message_id where m.thread_id=threads.id),
    snippet=coalesce((select snippet from messages where thread_id=threads.id order by sent_at desc,id desc limit 1),'') where id=? and mailbox_id=?`).bind(row.thread_id,mailboxId));
  await env.DB.batch(statements);
  if(!await env.DB.prepare('select id from messages where id=? and mailbox_id=?').bind(messageId,mailboxId).first()) {
    await env.BLOB.delete(parsed.attachments.map((_,i)=>key(i)));
    return Response.json({error:{message:'Message was deleted.'}},{status:404});
  }
  return Response.json({ok:true});
}
