// Account mail (address check, password reset) through Resend's HTTP API — one fetch, no SDK.
// Without RESEND_API_KEY the message is printed to the server log instead, so local runs and tests need no mail account.
export function makeMailer({apiKey=process.env.RESEND_API_KEY,from=process.env.MAIL_FROM||'harukan <no-reply@leneu.store>',log=console.log}={}) {
  return async function send({to,subject,text,html}) {
    if(!apiKey) {log(`[mail] to ${to} · ${subject}\n${text}`);return;}
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject,text,...(html?{html}:{})})});
    if(!response.ok) throw Error(`mail ${response.status}: ${(await response.text()).slice(0,200)}`);
  };
}

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const ink='#20322d',paper='#f6f5f0',leaf='#d8e6b5',muted='#5f6b66',line='#e4e2da';

// The logo drawn with table cells, so it shows without loading an image (mail apps block remote images, and SVG rarely renders).
// Same 3×3 grid as public/brand/harukan.svg: filled cells spell h, the top-right cell is the clock.
function logo() {
  const cell=(fill,extra='')=>`<td width="6" height="6" style="width:6px;height:6px;padding:0;font-size:0;line-height:0;background:${fill};border-radius:1.5px;${extra}">&nbsp;</td>`;
  const gap='<td width="2" style="width:2px;padding:0;font-size:0;line-height:0">&nbsp;</td>';
  const faint='rgba(246,245,240,.14)';
  const rows=[[paper,faint,'clock'],[paper,paper,paper],[paper,faint,paper]];
  const body=rows.map(row=>`<tr>${row.map((fill,i)=>(i?gap:'')+(fill==='clock'?cell(leaf,'border-radius:50%'):cell(fill))).join('')}</tr>`).join(`<tr><td colspan="5" height="2" style="height:2px;padding:0;font-size:0;line-height:0">&nbsp;</td></tr>`);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${ink};border-radius:7px"><tr><td style="padding:5px"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${body}</table></td></tr></table>`;
}

// One message shape for every account mail: logo, heading, a line or two, one button, the link as text, then why you got it.
export function accountMail({kind,name,link,contact='support@leneu.store'}) {
  const verify=kind==='verify';
  const subject=verify?'[harukan] 이메일 주소를 확인해 주세요':'[harukan] 비밀번호 재설정';
  const heading=verify?'이메일 주소를 확인해 주세요':'새 비밀번호를 정해 주세요';
  const lines=verify
    ?[`${name}님, harukan에 이 주소를 등록하려면 아래 버튼을 눌러 주세요.`,'링크는 3일 동안 쓸 수 있어요.']
    :[`${name}님, 비밀번호 재설정을 요청하셨어요. 아래 버튼에서 새 비밀번호를 정해 주세요.`,'링크는 30분 동안, 한 번만 쓸 수 있어요. 바꾸면 다른 기기의 로그인은 끝나요.'];
  const action=verify?'이메일 확인하기':'비밀번호 다시 정하기';
  const ignore=verify?'직접 요청하지 않았다면 이 메일은 무시해 주세요. 주소는 등록되지 않아요.':'직접 요청하지 않았다면 이 메일은 무시해 주세요. 비밀번호는 바뀌지 않아요.';
  const text=`${lines.join(' ')}\n\n${action}: ${link}\n\n${ignore}\n\n— harukan · 문의 ${contact}`;
  const font="-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Pretendard','Malgun Gothic',sans-serif";
  const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:${paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(lines[0])}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${paper}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;font-family:${font};color:${ink}">
<tr><td style="padding:0 4px 18px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px">${logo()}</td><td style="font-size:19px;font-weight:700;letter-spacing:-.2px;color:${ink}">harukan</td></tr></table></td></tr>
<tr><td style="background:#ffffff;border:1px solid ${line};border-radius:12px;padding:32px 28px">
<h1 style="margin:0 0 14px;font-size:20px;line-height:1.4;font-weight:700;color:${ink}">${escape(heading)}</h1>
${lines.map(l=>`<p style="margin:0 0 8px;font-size:15px;line-height:1.65;color:${ink}">${escape(l)}</p>`).join('')}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 22px"><tr><td style="background:${ink};border-radius:8px"><a href="${escape(link)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${escape(action)}</a></td></tr></table>
<p style="margin:0 0 4px;font-size:13px;line-height:1.6;color:${muted}">버튼이 눌리지 않으면 아래 주소를 복사해 브라우저에 붙여 넣어 주세요.</p>
<p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all"><a href="${escape(link)}" style="color:${muted}">${escape(link)}</a></p>
</td></tr>
<tr><td style="padding:18px 6px 0;font-size:12px;line-height:1.7;color:${muted}">${escape(ignore)}<br>harukan · 하루 144칸, 어디에 쓸지 먼저 정해요 · 문의 <a href="mailto:${escape(contact)}" style="color:${muted}">${escape(contact)}</a></td></tr>
</table></td></tr></table></body></html>`;
  return {subject,text,html};
}
