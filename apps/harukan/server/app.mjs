import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { openStore, transaction, validDate, emptyDay, validateDay } from './store.mjs';
import {recordDeletion,purgeDeletions} from './deletions.mjs';
import {listPlanning,savePlanning,deletePlanning} from './planning.mjs';
import {makeMailer,accountMail} from './mail.mjs';

const derive=promisify(scrypt), digest=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const passwordOK=value=>typeof value==='string'&&value.length>=12&&value.length<=128;
const normalizeEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
const emailOK=value=>value.length<=254&&/^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
// A nickname is only shown on screen: 2–20 characters, any script, no control characters.
const normalizeNickname=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
// No control characters, and no invisible direction/zero-width marks that could disguise the name (U+200B–200F, U+202A–202E, U+2060–2069, U+FEFF).
// An IANA zone the runtime knows (e.g. Asia/Seoul). It only decides which date is 'today' and where the now-line sits; records keep their own date and clock times.
const timezoneOK=value=>{if(typeof value!=='string'||!value||value.length>64)return false;try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}};
const nicknameOK=value=>[...value].length>=2&&[...value].length<=20&&!/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(value);
let activeHashes=0;
async function hash(password,existing) {
  if(activeHashes>=4) throw Object.assign(Error('요청이 많아요. 잠시 후 다시 시도해 주세요.'),{status:503});
  activeHashes++;
  try {
    const salt=existing?.split(':')[0]??randomBytes(16).toString('hex');
    const key=await derive(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
    return `${salt}:${key.toString('hex')}`;
  } finally {activeHashes--;}
}
const dummyHash='0123456789abcdef0123456789abcdef:'+ '0'.repeat(64);
async function matches(password,stored=dummyHash) {
  const candidate=await hash(password,stored);
  return timingSafeEqual(Buffer.from(candidate),Buffer.from(stored));
}
const apiError=(status,message,code)=>Object.assign(Error(message),{status,code});
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req) {
  if(!String(req.headers['content-type']||'').startsWith('application/json')) throw apiError(415,'JSON 형식으로 요청해 주세요.');
  let chunks=[],length=0;
  for await(const chunk of req) {length+=chunk.length;if(length>256*1024) throw apiError(413,'요청 내용이 너무 커요.');chunks.push(chunk);}
  try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch {throw apiError(400,'요청 내용을 읽을 수 없어요.');}
}

export function makeApp(options={}) {
  const production=options.production??process.env.NODE_ENV==='production';
  const origin=options.origin??process.env.PUBLIC_ORIGIN??'http://127.0.0.1:5175';
  const urlOrigin=new URL(origin);
  if(production&&urlOrigin.protocol!=='https:') throw Error('운영 PUBLIC_ORIGIN은 HTTPS여야 합니다.');
  // Former addresses (e.g. leneu.store after the move to harukan.leneu.store): every request is sent to the same path on PUBLIC_ORIGIN.
  const personalOrigin=(options.personalOrigin||process.env.PERSONAL_ORIGIN||'https://anotar.leneu.store').replace(/\/$/,'');
  const redirectHosts=new Set((options.redirectHosts??(process.env.REDIRECT_FROM_HOSTS||'').split(',')).map(h=>h.trim().toLowerCase()).filter(h=>h&&h!==urlOrigin.host));
  const dataDirectory=options.dataDirectory??process.env.PLANNER_DATA_DIR??'./data';
  const db=openStore(dataDirectory);
  const dist=resolve(options.dist??'dist');
  const legal={
    operator:process.env.OPERATOR_NAME||'문성혁',representative:process.env.OPERATOR_REPRESENTATIVE||'개인 운영',
    businessNumber:process.env.BUSINESS_NUMBER||'',address:process.env.BUSINESS_ADDRESS||'',
    contact:process.env.CONTACT_EMAIL||'support@leneu.store',privacyContact:process.env.PRIVACY_CONTACT||'문성혁',
    publishedAt:process.env.LEGAL_PUBLISHED_AT||'',hostingRegion:process.env.HOSTING_REGION||'',
    ...(options.legal??{})
  };
  const legalReviewed=options.legalReviewed??process.env.LEGAL_REVIEWED==='true';
  const legalReady=Boolean(legalReviewed&&legal.operator&&legal.contact&&legal.privacyContact&&legal.publishedAt&&legal.hostingRegion);
  const registration=(options.registration??process.env.REGISTRATION_ENABLED==='true')&&(!production||legalReady);
  const cookieName=production?'__Host-anotar-planner':'anotar-planner-dev';
  const cookie=value=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value?sessionDays*86400:0}${production?'; Secure':''}`;
  const termsVersion='2026-10-18';
  // Stay signed in: a session lasts 30 days from the last visit (each app open renews it at most once a day).
  const sessionDays=30;
  const writeLimit=options.writeLimit??1200,storageLimit=options.storageLimit??50*1024*1024;
  const clock=options.clock??Date.now;
  // A pending security reboot, written on the host by leneu-service-watch and mounted read-only.
  // Shown only in the last hour before it, so most people never see it.
  const hostStatusFile=options.hostStatusFile??process.env.HOST_STATUS_FILE;
  async function maintenance(){
    if(!hostStatusFile) return null;
    try{const s=JSON.parse(await readFile(hostStatusFile,'utf8')),at=Date.parse(s.rebootAt);return s.rebootRequired&&at>clock()&&at-clock()<=3600000?{at:new Date(at).toISOString()}:null;}
    catch{return null;}
  }
  const sendMail=options.mailer??makeMailer();
  const mailLife={verify:86400000,reset:30*60000};
  // New accounts are usable only after the email link is opened (tests of other features turn this off).
  const verifySignups=options.verifySignups??true;
  // An unconfirmed sign-up without any saved data is gone after a day, freeing the address.
  function dropUnconfirmed(where,...args) {
    for(const {id} of db.prepare(`SELECT id FROM users WHERE email IS NOT NULL AND email_verified_at IS NULL AND ${where} AND NOT EXISTS(SELECT 1 FROM days WHERE user_id=users.id) AND NOT EXISTS(SELECT 1 FROM planning WHERE user_id=users.id)`).all(...args)){
      recordDeletion(dataDirectory,id,clock());db.prepare('DELETE FROM users WHERE id=?').run(id);
    }
  }
  function cleanup() {
    if(verifySignups) dropUnconfirmed('created_at<=?',clock()-mailLife.verify);
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(clock());
    db.prepare('DELETE FROM auth_limits WHERE expires_at<=?').run(clock());
    db.prepare('DELETE FROM mail_tokens WHERE expires_at<=?').run(clock());
    purgeDeletions(dataDirectory,clock());
  }
  cleanup();
  const cleanupTimer=setInterval(cleanup,60*60*1000);cleanupTimer.unref();
  function limit(key,max,window) {
    const now=clock(),hashed=digest(key);
    transaction(db,()=>{
      const row=db.prepare('SELECT * FROM auth_limits WHERE key=?').get(hashed);
      if(row&&row.expires_at>now&&row.count>=max) throw apiError(429,'시도가 많아요. 잠시 후 다시 시도해 주세요.');
      db.prepare('INSERT INTO auth_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires_at=excluded.expires_at').run(hashed,row&&row.expires_at>now?row.count+1:1,row&&row.expires_at>now?row.expires_at:now+window);
    });
  }
  function session(req) {
    const cookies=String(req.headers.cookie||'').split(';').map(s=>s.trim().split('='));
    const values=cookies.filter(([name])=>name===cookieName);
    if(values.length!==1||!values[0][1]||values[0][1].length>80) return null;
    return db.prepare('SELECT sessions.*,users.username,users.timezone,users.email,users.email_verified_at,users.nickname FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(digest(values[0][1]),clock());
  }
  // What the app sees of an account.
  const publicUser=u=>({id:u.id??u.user_id,nickname:u.nickname||u.username,email:u.email||null,emailVerified:Boolean(u.email&&u.email_verified_at),timezone:u.timezone||'Asia/Seoul'});
  // One link per kind and person at a time: a new one replaces the old. Sending failures are logged, never shown, so they reveal nothing.
  async function mailLink(user,kind,email) {
    const value=token();
    transaction(db,()=>{
      db.prepare('DELETE FROM mail_tokens WHERE user_id=? AND kind=?').run(user.id,kind);
      db.prepare('INSERT INTO mail_tokens VALUES(?,?,?,?,?)').run(digest(value),user.id,kind,email,clock()+mailLife[kind]);
    });
    const link=`${origin}/${kind}?token=${value}`,name=user.nickname||user.username;
    const mail=accountMail({kind,name,link,contact:legal.contact});
    try {await sendMail({to:email,...mail});}catch(error) {console.error('[mail] failed',error.message);}
  }
  function takeMailToken(value,kind) {
    if(typeof value!=='string'||value.length>80) return null;
    return transaction(db,()=>{
      const row=db.prepare('SELECT * FROM mail_tokens WHERE token_hash=? AND kind=? AND expires_at>?').get(digest(value),kind,clock());
      if(row) db.prepare('DELETE FROM mail_tokens WHERE token_hash=?').run(row.token_hash);
      return row;
    });
  }
  function newSession(user,res) {
    const value=token(),csrf=token();
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(value),user.id,csrf,clock()+sessionDays*86400000);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN(SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT 10)').run(user.id,user.id);
    res.setHeader('Set-Cookie',cookie(value));
    return {user:publicUser(user),csrf};
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url=new URL(req.url,'http://localhost'),path=url.pathname,write=!['GET','HEAD'].includes(req.method);
      if(path==='/api/health') return json(res,200,{ok:true,service:'anotar-planner'});
      // Former personal-app bookmarks (this host once served anotar) go straight to anotar.
      if(!write&&/^\/(pages(?:\/|$)|memo(?:\/|$)|tasks(?:\/|$)|ai(?:\/|$)|ai-jobs(?:\/|$)|comments(?:\/|$))/.test(path)){res.writeHead(302,{Location:personalOrigin+path+url.search,'Cache-Control':'no-store'});return res.end();}
      if(redirectHosts.has(String(req.headers.host||'').toLowerCase())){res.writeHead(write?308:301,{Location:origin+path+url.search,'Cache-Control':'no-store'});return res.end();}
      if(!path.startsWith('/api/')) {
        if(!['GET','HEAD'].includes(req.method)) throw apiError(405,'지원하지 않는 요청이에요.');
        // The personal app's 일지 moved here: /journal opens the schedule.
        if(/^\/journal(?:\/|$)/.test(path)){res.writeHead(302,{Location:'/app'+url.search,'Cache-Control':'no-store'});return res.end();}
        // Signed in: home and the sign-in pages go straight to the schedule.
        if(['/','/login','/signup'].includes(path)&&session(req)){res.writeHead(302,{Location:'/app','Cache-Control':'no-store'});return res.end();}
        const target=resolve(dist,'.'+decodeURIComponent(path));
        if(!target.startsWith(dist+sep)&&target!==dist) throw apiError(404,'찾을 수 없어요.');
        let file=target;
        try {if(!(await stat(file)).isFile()) file=resolve(dist,'index.html');}catch {file=resolve(dist,'index.html');}
        if(extname(path)&&file.endsWith('index.html')&&path!=='/index.html') throw apiError(404,'파일을 찾을 수 없어요.');
        const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'}[extname(file)]||'application/octet-stream';
        res.writeHead(200,{'Content-Type':type,'Cache-Control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
        return res.end(req.method==='HEAD'?undefined:await readFile(file));
      }
      if(write&&(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')) throw apiError(403,'현재 사이트에서 다시 요청해 주세요.');
      if(path==='/api/site'&&req.method==='GET') return json(res,200,{legal,legalReady,registration,termsVersion,maintenance:await maintenance()});
      if(path==='/api/auth/session'&&req.method==='GET') {
        const s=session(req);
        if(s&&s.expires_at-clock()<(sessionDays-1)*86400000){
          db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(clock()+sessionDays*86400000,s.token_hash);
          const raw=String(req.headers.cookie||'').split(';').map(c=>c.trim().split('=')).find(([name])=>name===cookieName)[1];
          res.setHeader('Set-Cookie',cookie(raw));
        }
        return json(res,200,s?{user:publicUser(s),csrf:s.csrf}:{user:null});
      }
      const ip=production?String(req.headers['cf-connecting-ip']||req.socket.remoteAddress):req.socket.remoteAddress;
      if(path==='/api/auth/register'&&req.method==='POST') {
        const data=await body(req),email=normalizeEmail(data.email),nickname=normalizeNickname(data.nickname);
        limit('ip:'+ip,30,15*60000);
        if(!emailOK(email)||!nicknameOK(nickname)||!passwordOK(data.password)) throw apiError(400,'이메일, 닉네임(2–20자), 비밀번호(12–128자)를 확인해 주세요.');
        if(!registration) throw apiError(403,'가입 준비 중이에요. 체험 화면을 먼저 이용해 주세요.');
        if(data.termsVersion!==termsVersion||data.ageConfirmed!==true) throw apiError(400,'이용약관과 만 14세 이상 여부를 확인해 주세요.');
        limit('signup:'+ip,5,86400000);
        // People sign in with their email. username and recovery_hash are internal columns kept from the first schema (a random handle and an unused hash).
        const password=await hash(data.password),timezone=timezoneOK(data.timezone)?data.timezone:'Asia/Seoul',user={id:randomUUID(),username:'u-'+randomBytes(6).toString('hex'),nickname,email,timezone};
        // Signing up again with an address nobody confirmed replaces that sign-up.
        try {transaction(db,()=>{if(verifySignups)dropUnconfirmed('email=?',email);db.prepare('INSERT INTO users(id,username,password,recovery_hash,created_at,terms_version,email,nickname,timezone) VALUES(?,?,?,?,?,?,?,?,?)').run(user.id,user.username,password,digest(token()),clock(),termsVersion,email,nickname,timezone);});}
        catch(error) {if(String(error.message).includes('UNIQUE')) throw apiError(409,'이미 가입한 이메일이에요. 로그인하거나 비밀번호를 재설정해 주세요.');throw error;}
        await mailLink(user,'verify',email);
        return verifySignups?json(res,201,{pending:true,email}):json(res,201,newSession(user,res));
      }
      if(path==='/api/auth/login'&&req.method==='POST') {
        const data=await body(req),login=normalizeEmail(data.login);
        limit('ip:'+ip,30,15*60000);limit('account:'+login,12,15*60000);
        if(!login||login.length>254||!passwordOK(data.password)) throw apiError(401,'이메일 또는 비밀번호를 확인해 주세요.');
        const user=db.prepare('SELECT * FROM users WHERE email=?').get(login);
        if(!await matches(data.password,user?.password)||!user) throw apiError(401,'이메일 또는 비밀번호를 확인해 주세요.');
        if(db.prepare('SELECT password FROM users WHERE id=?').get(user.id)?.password!==user.password) throw apiError(401,'계정 정보가 바뀌었어요. 다시 로그인해 주세요.');
        if(verifySignups&&!user.email_verified_at) throw apiError(403,'이메일 확인이 필요해요. 가입할 때 받은 메일의 링크를 열어 주세요.','unverified');
        return json(res,200,newSession(user,res));
      }
      if(path==='/api/auth/forgot'&&req.method==='POST') {
        // Same answer whether or not the address has an account.
        const data=await body(req),email=normalizeEmail(data.email);
        limit('ip:'+ip,10,15*60000);
        if(!emailOK(email)) throw apiError(400,'이메일 주소를 확인해 주세요.');
        limit('forgot:'+email,3,60*60000);
        const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if(user) await mailLink(user,'reset',email);
        return json(res,200,{ok:true});
      }
      if(path==='/api/auth/resend'&&req.method==='POST') {
        // A new sign-up link for an unconfirmed address; same answer either way.
        const data=await body(req),email=normalizeEmail(data.email);
        limit('ip:'+ip,10,15*60000);
        if(!emailOK(email)) throw apiError(400,'이메일 주소를 확인해 주세요.');
        limit('resend:'+email,3,60*60000);
        const user=db.prepare('SELECT * FROM users WHERE email=? AND email_verified_at IS NULL').get(email);
        if(user) await mailLink(user,'verify',email);
        return json(res,200,{ok:true});
      }
      if(path==='/api/auth/reset'&&req.method==='POST') {
        const data=await body(req);limit('ip:'+ip,30,15*60000);
        if(!passwordOK(data.password)) throw apiError(400,'비밀번호는 12–128자로 입력해 주세요.');
        const password=await hash(data.password),row=takeMailToken(data.token,'reset');
        if(!row) throw apiError(400,'만료됐거나 이미 쓴 링크예요. 비밀번호 재설정을 다시 요청해 주세요.');
        // Opening the link proves the address, so it also counts as checked.
        transaction(db,()=>{
          db.prepare('UPDATE users SET password=?,email_verified_at=CASE WHEN email=? THEN COALESCE(email_verified_at,?) ELSE email_verified_at END WHERE id=?').run(password,row.email,clock(),row.user_id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
          db.prepare("DELETE FROM mail_tokens WHERE user_id=? AND kind='reset'").run(row.user_id);
        });
        return json(res,200,newSession(db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id),res));
      }
      if(path==='/api/auth/verify'&&req.method==='POST') {
        const data=await body(req);limit('ip:'+ip,30,15*60000);
        const row=takeMailToken(data.token,'verify');
        if(!row) throw apiError(400,'만료됐거나 이미 쓴 링크예요. 로그인 화면에서 확인 메일을 다시 받거나, 하루가 지났다면 다시 가입해 주세요.');
        try {db.prepare('UPDATE users SET email=?,email_verified_at=? WHERE id=?').run(row.email,clock(),row.user_id);}
        catch(error) {if(String(error.message).includes('UNIQUE')) throw apiError(409,'다른 계정이 이미 쓰는 이메일이에요.');throw error;}
        // The link came from that mailbox, so opening it also signs in.
        return json(res,200,{...newSession(db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id),res),email:row.email});
      }
      const s=session(req);if(!s) throw apiError(401,'로그인이 필요해요.');
      if(write&&req.headers['x-csrf-token']!==s.csrf) throw apiError(403,'로그인 상태를 새로 확인해 주세요. 입력한 내용은 그대로 남아요.');
      // Saving is automatic (about one write a second while typing); this only stops scripts hammering the server.
      if(write) limit('write:'+s.user_id,writeLimit,10*60000);
      if(path==='/api/planning'&&req.method==='GET')return json(res,200,{items:listPlanning(db,s.user_id)});
      const planningMatch=path.match(/^\/api\/planning\/([a-zA-Z0-9_-]{1,80})$/);
      if(planningMatch&&req.method==='PUT')return json(res,200,savePlanning(db,s.user_id,planningMatch[1],await body(req),clock()));
      if(planningMatch&&req.method==='DELETE'){const data=await body(req);return json(res,200,deletePlanning(db,s.user_id,planningMatch[1],data.version,clock()));}
      if(path==='/api/auth/logout'&&req.method==='POST') {db.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.token_hash);res.setHeader('Set-Cookie',cookie(''));return json(res,200,{ok:true});}
      if(path==='/api/account'&&req.method==='DELETE') {
        const data=await body(req);limit('delete:'+s.user_id,5,15*60000);
        const user=db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
        if(normalizeEmail(data.confirmation)!==s.email||!passwordOK(data.password)||!await matches(data.password,user.password)) throw apiError(400,'이메일과 비밀번호로 탈퇴를 확인해 주세요.');
        transaction(db,()=>{
          if(db.prepare('SELECT password FROM users WHERE id=?').get(s.user_id)?.password!==user.password)throw apiError(409,'계정 정보가 바뀌었어요. 다시 확인해 주세요.');
          recordDeletion(dataDirectory,s.user_id,clock());
          db.prepare('DELETE FROM users WHERE id=? AND password=?').run(s.user_id,user.password);
        });
        res.setHeader('Set-Cookie',cookie(''));return json(res,200,{ok:true});
      }
      if(path==='/api/account/password'&&req.method==='POST') {
        const data=await body(req);limit('password:'+s.user_id,5,15*60000);
        const user=db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
        if(!passwordOK(data.currentPassword)||!passwordOK(data.password)||!await matches(data.currentPassword,user.password)) throw apiError(400,'현재 비밀번호와 새 비밀번호를 확인해 주세요.');
        const password=await hash(data.password);
        transaction(db,()=>{
          const result=db.prepare('UPDATE users SET password=? WHERE id=? AND password=?').run(password,user.id,user.password);
          if(result.changes!==1) throw apiError(409,'계정 정보가 바뀌었어요. 다시 확인해 주세요.');
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
        });
        return json(res,200,newSession(user,res));
      }
      if(path==='/api/account/profile'&&req.method==='POST') {
        const nickname=normalizeNickname((await body(req)).nickname);
        if(!nicknameOK(nickname)) throw apiError(400,'닉네임은 2–20자로 입력해 주세요.');
        db.prepare('UPDATE users SET nickname=? WHERE id=?').run(nickname,s.user_id);
        return json(res,200,{user:publicUser({...s,nickname})});
      }
      if(path==='/api/account/timezone'&&req.method==='POST') {
        const timezone=(await body(req)).timezone;
        if(!timezoneOK(timezone)) throw apiError(400,'시간대를 확인해 주세요.');
        db.prepare('UPDATE users SET timezone=? WHERE id=?').run(timezone,s.user_id);
        return json(res,200,{user:publicUser({...s,timezone})});
      }
      if(path==='/api/account/email'&&req.method==='POST') {
        // Sends a check link; the address changes only when that link is opened. No email = resend for the current one.
        const data=await body(req),email=normalizeEmail(data.email??s.email);limit('email:'+s.user_id,5,60*60000);
        if(!emailOK(email)) throw apiError(400,'이메일 주소를 확인해 주세요.');
        if(email===s.email&&s.email_verified_at) throw apiError(400,'이미 확인한 이메일이에요.');
        if(db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(email,s.user_id)) throw apiError(409,'다른 계정이 이미 쓰는 이메일이에요.');
        await mailLink({id:s.user_id,username:s.username,nickname:s.nickname},'verify',email);
        return json(res,200,{ok:true,email});
      }
      if(path==='/api/export'&&req.method==='GET') return json(res,200,{format:'anotar-planner-v1',user:{nickname:s.nickname,email:s.email,timezone:s.timezone},days:db.prepare('SELECT date,document,version FROM days WHERE user_id=? ORDER BY date').all(s.user_id).map(d=>({...d,document:JSON.parse(d.document)})),planning:listPlanning(db,s.user_id)});
      if(path==='/api/days'&&req.method==='GET') {
        const from=url.searchParams.get('from'),to=url.searchParams.get('to');
        if((from!==null||to!==null)&&(!validDate(from)||!validDate(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>365)) throw apiError(400,'날짜를 확인해 주세요.');
        const rows=from?db.prepare('SELECT date,document,version FROM days WHERE user_id=? AND date>=? AND date<=? ORDER BY date DESC').all(s.user_id,from,to):db.prepare('SELECT date,document,version FROM days WHERE user_id=? ORDER BY date DESC LIMIT 400').all(s.user_id);
        return json(res,200,{items:rows.map(d=>({date:d.date,version:d.version,document:JSON.parse(d.document)}))});
      }
      const dayMatch=path.match(/^\/api\/days\/([^/]+)$/);
      if(dayMatch) {
        const date=dayMatch[1];if(!validDate(date)) throw apiError(400,'날짜를 확인해 주세요.');
        const get=()=>db.prepare('SELECT document,version FROM days WHERE user_id=? AND date=?').get(s.user_id,date);
        if(req.method==='GET') {const row=get();return json(res,200,{date,version:row?.version||0,document:row?JSON.parse(row.document):emptyDay()});}
        if(req.method==='PUT') {
          const data=await body(req);if(!Number.isInteger(data.version)||data.version<0) throw apiError(400,'저장 버전을 확인해 주세요.');
          let document;try{document=validateDay(data.document,db,s.user_id);}catch(error){throw apiError(400,error.message);}
          const version=transaction(db,()=>{
            const current=get();
            // A cap on everything one account keeps, so one person can't fill the disk (years of normal use stay far below it).
            const others=db.prepare('SELECT COALESCE(SUM(length(document)),0) n FROM days WHERE user_id=? AND date<>?').get(s.user_id,date).n;
            if(others+JSON.stringify(document).length>storageLimit) throw apiError(413,'저장 공간이 가득 찼어요. 오래된 기록을 내보낸 뒤 정리해 주세요.');
            if((current?.version||0)!==data.version) throw apiError(409,'다른 기기에서 먼저 수정했어요. 내 내용을 내보낸 뒤 최신 기록을 확인해 주세요.');
            db.prepare('INSERT INTO days VALUES(?,?,?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET document=excluded.document,version=excluded.version,updated_at=excluded.updated_at').run(s.user_id,date,JSON.stringify(document),data.version+1,clock());
            return data.version+1;
          });
          return json(res,200,{date,document,version});
        }
      }
      if(path==='/api/tasks'||path.startsWith('/api/tasks/'))throw apiError(410,'할 일 기능은 종료됐어요. 일정과 계획을 이용해 주세요.');
      throw apiError(404,'요청한 내용을 찾을 수 없어요.');
    } catch(error) {json(res,error.status||500,{message:error.status?error.message:'저장하지 못했어요. 입력 내용을 보관하고 다시 시도해 주세요.',...(error.code?{code:error.code}:{})});}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,db,close:()=>new Promise(resolve=>{clearInterval(cleanupTimer);server.close(()=>{db.close();resolve();});})};
}
