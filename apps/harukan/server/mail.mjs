// Account mail (address check, password reset) through Resend's HTTP API — one fetch, no SDK.
// Without RESEND_API_KEY the message is printed to the server log instead, so local runs and tests need no mail account.
export function makeMailer({apiKey=process.env.RESEND_API_KEY,from=process.env.MAIL_FROM||'harukan <no-reply@leneu.store>',log=console.log}={}) {
  return async function send({to,subject,text}) {
    if(!apiKey) {log(`[mail] to ${to} · ${subject}\n${text}`);return;}
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject,text})});
    if(!response.ok) throw Error(`mail ${response.status}: ${(await response.text()).slice(0,200)}`);
  };
}
