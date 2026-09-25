// Single-owner access. The password lives only in the APP_PASSWORD environment
// variable; the session cookie is an HMAC of its expiry keyed by that password,
// so changing the password signs every session out.
export const SESSION_COOKIE='rm_session';
export const OWNER='owner';
export const MIN_PASSWORD_LENGTH=12;
const DAYS=30,encoder=new TextEncoder();
const base64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromBase64url=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function hmacKey(secret){
 const raw=await crypto.subtle.digest('SHA-256',encoder.encode('reappro-metro-session\0'+secret));
 return crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export const configuredPassword=(env=process.env)=>{const p=env.APP_PASSWORD;return typeof p==='string'&&p.length>=MIN_PASSWORD_LENGTH?p:null;};
export async function sessionToken(password,now=Date.now()){
 const expires=String(now+DAYS*86400000);
 return expires+'.'+base64url(await crypto.subtle.sign('HMAC',await hmacKey(password),encoder.encode(expires)));
}
export async function validSession(token,password,now=Date.now()){
 if(!password||typeof token!=='string')return false;
 const parts=token.split('.'),[expires,signature]=parts;
 if(parts.length!==2||!/^\d{13,}$/.test(expires||'')||+expires<now||!/^[\w-]{40,50}$/.test(signature||''))return false;
 return crypto.subtle.verify('HMAC',await hmacKey(password),fromBase64url(signature),encoder.encode(expires));
}
// Compares fixed-length digests so the check time does not depend on the input.
export async function passwordMatches(input,password){
 if(typeof input!=='string'||!password||input.length>1000)return false;
 const key=await hmacKey('password-check'),[a,b]=await Promise.all([input,password].map(v=>crypto.subtle.sign('HMAC',key,encoder.encode(v)))),x=new Uint8Array(a),y=new Uint8Array(b);
 let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
export function readCookie(header,name){
 for(const part of (header||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===name)return part.slice(i+1).trim();}
 return null;
}
export const sessionCookie=(token,maxAge=DAYS*86400)=>`${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
export async function currentUser(req,env=process.env){
 return await validSession(readCookie(req.headers.get('cookie'),SESSION_COOKIE),configuredPassword(env))?OWNER:null;
}
// Writes must come from this site. Behind the hosting proxy the handler's own URL
// may carry another scheme or host than the browser used, so the Origin host is
// compared with every host the request was addressed to. A request the browser
// itself marks cross-site is always refused.
export function sameOrigin(req){
 const site=req.headers.get('sec-fetch-site'),origin=req.headers.get('origin');
 if(site==='cross-site')return false;
 if(!origin)return site==='same-origin';
 let host;try{host=new URL(origin).host;}catch{return false;}
 const hosts=[new URL(req.url).host,req.headers.get('x-forwarded-host'),req.headers.get('host')].flatMap(h=>(h||'').split(',')).map(h=>h.trim().toLowerCase()).filter(Boolean);
 return hosts.includes(host.toLowerCase());
}
