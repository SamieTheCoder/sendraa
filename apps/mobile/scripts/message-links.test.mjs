import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageParts, htmlToText, webLink } from '../src/mail/message-links.ts';

test('signed verification URL stays byte-for-byte intact',()=>{
  const url='https://mail.google.com/mail/f-%5Bexample-Ab_12%2Fxyz%5D-abc=';
  const body=`Confirm:\n\n${url}\n\nThanks`;
  const parts=messageParts(body);
  assert.deepEqual(parts.filter((p)=>p.kind==='link'),[{kind:'link',value:url}]);
  assert.equal(parts.map((p)=>p.value).join(''),body);
});
test('punctuation outside links is not copied; balanced parentheses remain',()=>{
  const parts=messageParts('See (https://example.com/a_(b)). Then https://example.com/next!');
  assert.deepEqual(parts.filter((p)=>p.kind==='link').map((p)=>p.value),['https://example.com/a_(b)','https://example.com/next']);
});
test('unsafe schemes and embedded credentials are not linked',()=>{
  for(const url of ['javascript:alert(1)','file:///secret','https://name:password@example.com','https://exa mple.com','https://example.com\\evil'])assert.equal(webLink(url),false);
});
test('HTML anchor destinations survive text conversion',()=>{
  const text=htmlToText('<head>hidden</head><script>alert(1)</script><p>Confirm <a href="https://example.com/?a=1&amp;b=%5Btoken%5D">your address</a>.</p>');
  assert.ok(text.includes('your address'));
  assert.deepEqual(messageParts(text).filter((p)=>p.kind==='link').map((p)=>p.value),['https://example.com/?a=1&b=%5Btoken%5D']);
  assert.ok(!text.includes('alert')&&!text.includes('hidden'));
});
test('non-web HTML hrefs stay plain text',()=>{
  assert.equal(htmlToText('<a href="javascript:alert(1)">Hello &#x1f44b;</a>'),'Hello 👋');
});
