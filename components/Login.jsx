'use client';
import {useState} from 'react';

export default function Login(){
 const [password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(e){
  e.preventDefault();setBusy(true);setError('');
  try{const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})}),j=await r.json();if(!r.ok)throw Error(j.error||'Connexion impossible.');window.location.reload();}
  catch(x){setError(x.message);setBusy(false);}
 }
 return <main className="independent clean-performance login-page">
  <header className="workspace-header"><div className="brand"><span className="brandmark">S</span><div><b>Shop Santé</b><span>Réappro Metro</span></div></div></header>
  <form className="login-form" onSubmit={submit}>
   <h1>Connexion</h1><p>Espace privé. Entrez le mot de passe du site.</p>
   {error&&<p role="alert" className="alert">{error}</p>}
   <label>Mot de passe<input type="password" autoComplete="current-password" required autoFocus value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <button className="primary" disabled={busy||!password}>{busy?'Connexion…':'Se connecter'}</button>
  </form>
 </main>;
}
