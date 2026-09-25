import test from 'node:test';import assert from 'node:assert/strict';
import {SESSION_COOKIE,configuredPassword,currentUser,passwordMatches,readCookie,sessionCookie,sessionToken,validSession} from '../lib/auth.js';
const password='un-mot-de-passe-long';
const req=cookie=>new Request('https://test.invalid/api/x',{headers:cookie?{cookie}:{}});
test('mot de passe : absent ou trop court = aucune connexion possible',()=>{assert.equal(configuredPassword({}),null);assert.equal(configuredPassword({APP_PASSWORD:'court'}),null);assert.equal(configuredPassword({APP_PASSWORD:password}),password)});
test('comparaison du mot de passe',async()=>{assert.equal(await passwordMatches(password,password),true);for(const wrong of ['',password+'x','UN-MOT-DE-PASSE-LONG',null,'x'.repeat(2000)])assert.equal(await passwordMatches(wrong,password),false)});
test('session signée : valide, expirée, falsifiée, ou invalidée par un nouveau mot de passe',async()=>{
 const now=Date.parse('2026-09-24T12:00:00Z'),token=await sessionToken(password,now);
 assert.equal(await validSession(token,password,now+1000),true);
 assert.equal(await validSession(token,password,now+31*86400000),false);
 assert.equal(await validSession(token,'un-autre-mot-de-passe',now),false);
 const [expires,sig]=token.split('.');assert.equal(await validSession(String(+expires+86400000)+'.'+sig,password,now),false);
 assert.equal(await validSession(expires+'.'+sig.slice(0,-2)+'AA',password,now),false);
 for(const bad of [null,'',token+'.x','abc.def'])assert.equal(await validSession(bad,password,now),false)});
test('identité : cookie de session requis, propriétaire unique',async()=>{
 const env={APP_PASSWORD:password},token=await sessionToken(password);
 assert.equal(await currentUser(req(),env),null);
 assert.equal(await currentUser(req('autre=1; '+SESSION_COOKIE+'='+token),env),'owner');
 assert.equal(await currentUser(req(SESSION_COOKIE+'='+token),{}),null);
 assert.equal(readCookie('a=1; b=2=3',"b"),'2=3');
 assert.match(sessionCookie(token),/HttpOnly; Secure; SameSite=Strict; Max-Age=2592000$/);assert.match(sessionCookie('',0),/Max-Age=0$/)});
import {sameOrigin} from '../lib/auth.js';
test('origine : même site derrière le proxy accepté, autre site refusé',()=>{
 const r=(url,headers)=>new Request(url,{method:'POST',headers});
 const site='https://reappro-metro.netlify.app';
 assert.equal(sameOrigin(r(site+'/api/x',{origin:site})),true);
 // Handler URL rewritten by the proxy (internal host or plain http).
 assert.equal(sameOrigin(r('http://internal.local/api/x',{origin:site,'x-forwarded-host':'reappro-metro.netlify.app'})),true);
 assert.equal(sameOrigin(r('http://reappro-metro.netlify.app/api/x',{origin:site})),true);
 assert.equal(sameOrigin(r('http://internal.local/api/x',{origin:site,host:'REAPPRO-METRO.netlify.app'})),true);
 assert.equal(sameOrigin(r('http://internal.local/api/x',{'sec-fetch-site':'same-origin'})),true);
 for(const headers of [{origin:'https://evil.example'},{origin:'https://evil.example','x-forwarded-host':'evil.example.attacker'},{origin:site,'sec-fetch-site':'cross-site'},{},{origin:'null'},{origin:'pas une url'}])assert.equal(sameOrigin(r(site+'/api/x',headers)),false,JSON.stringify(headers))});
