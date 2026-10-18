import test from 'node:test';
import assert from 'node:assert/strict';
import {accountMail,makeMailer} from '../server/mail.mjs';

test('account mail: text and html carry the link; the nickname is escaped in html', () => {
  const link='https://leneu.store/verify?token=abc-123';
  for(const kind of ['verify','reset']) {
    const m=accountMail({kind,name:'<b>제이</b>&',link,contact:'support@leneu.store'});
    assert.match(m.subject,/^\[harukan\] /);
    assert.ok(m.text.includes(link)&&m.html.includes(`href="${link}"`));
    assert.ok(m.html.includes('&lt;b&gt;제이&lt;/b&gt;&amp;')&&!m.html.includes('<b>제이'));
    assert.ok(m.html.includes('mailto:support@leneu.store'));
  }
  assert.match(accountMail({kind:'reset',name:'a',link}).text,/30분/);
});

test('mailer without a key logs the text instead of sending', async () => {
  const lines=[];await makeMailer({apiKey:'',log:l=>lines.push(l)})({to:'a@example.test',subject:'s',text:'hello',html:'<p>x</p>'});
  assert.equal(lines.length,1);assert.ok(lines[0].includes('hello'));
});
