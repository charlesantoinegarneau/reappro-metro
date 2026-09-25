import {configuredPassword,passwordMatches,sessionCookie,sessionToken,sameOrigin} from '@/lib/auth';
export const dynamic='force-dynamic';
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
export async function POST(req){
 if(!sameOrigin(req))return json({error:'Origine invalide.'},403);
 const password=configuredPassword();
 if(!password)return json({error:'Mot de passe du site non configuré (variable APP_PASSWORD, 12 caractères minimum).'},503);
 let body;try{body=await req.json();}catch{return json({error:'Requête invalide.'},400);}
 // A fixed delay on failure slows down guessing.
 if(!await passwordMatches(body?.password,password)){await new Promise(r=>setTimeout(r,1000));return json({error:'Mot de passe incorrect.'},401);}
 return json({ok:true},200,{'Set-Cookie':sessionCookie(await sessionToken(password))});
}
export async function DELETE(req){
 if(!sameOrigin(req))return json({error:'Origine invalide.'},403);
 return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});
}
