import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { invitationEmail } from '../src/invite-template.js';
const dir=new URL('../../../brand/emails/',import.meta.url);
await mkdir(dir,{recursive:true});
const logo=await readFile(new URL('../../../apps/mobile/assets/images/icon.png',import.meta.url));
const {html}=invitationEmail({workspace:'Sendraa',email:'priya@example.com',address:'priya@sendraa.tech',link:'https://example.com/invitation-preview',logoUrl:`data:image/png;base64,${logo.toString('base64')}`,days:7});
await writeFile(new URL('invitation-preview.html',dir),html);
console.log('Created brand/emails/invitation-preview.html (sample only; no invitation sent).');
