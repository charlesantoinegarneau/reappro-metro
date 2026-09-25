'use client';
import MetroPanel from './MetroPanel';

async function logout(){await fetch('/api/session',{method:'DELETE'});window.location.reload();}
export default function MetroApp(){
 return <main className="independent clean-performance">
  <header className="workspace-header"><div className="brand"><span className="brandmark">S</span><div><b>Shop Santé</b><span>Réappro Metro</span></div></div><button className="quiet-button" onClick={logout}>Se déconnecter</button></header>
  <MetroPanel/>
 </main>;
}
