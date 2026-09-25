'use client';
import {useEffect,useMemo,useState} from 'react';
import {readSalesFile} from '@/lib/metro/sales';
import {orderCsv} from '@/lib/metro/order';

const CHUNK=20;
const dateLabel=d=>new Date(d+'T12:00:00Z').toLocaleDateString('fr-CA',{day:'numeric',month:'long'});
const pct=n=>Math.round(n*100)+' %';
const TREND={hausse:'↗ hausse',baisse:'↘ baisse',stable:'→ stable'};
const LABEL={aucune:'rien',reduite:'1 caisse de moins',regle:'la règle',hausse:'1 caisse de plus'};
async function api(query='',body){
 const r=await fetch('/api/metro'+query,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'}),j=await r.json();
 if(!r.ok)throw Error(j.error||'Erreur');return j;
}
function download(name,text){const url=URL.createObjectURL(new Blob(['﻿'+text],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
// Twelve weeks of sales as small bars, oldest first.
function Spark({history}){
 const max=Math.max(1,...history.map(h=>h.units)),w=5,gap=2;
 return <svg className="metro-spark" width={history.length*(w+gap)} height="22" role="img" aria-label={'Ventes par semaine : '+history.map(h=>h.units).join(', ')}>
  {history.map((h,i)=><rect key={h.week} x={i*(w+gap)} y={22-Math.max(1,h.units/max*22)} width={w} height={Math.max(1,h.units/max*22)} rx="1" fill={i>=history.length-4?'#197657':'#a9c2b3'}/>)}
 </svg>;
}

// Weekly Metro orders: the rules propose, Jev chooses, the owner validates.
export default function MetroPanel(){
 const [data,setData]=useState(null),[settings,setSettings]=useState({coverageDays:7,leadDays:3,safety:1.25}),[decisions,setDecisions]=useState({}),[final,setFinal]=useState({});
 const [scope,setScope]=useState(''),[onlyReview,setOnlyReview]=useState(false),[busy,setBusy]=useState(''),[progress,setProgress]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function load(s=settings){
  setError('');
  try{const j=await api('?'+new URLSearchParams(Object.entries(s).map(([k,v])=>[k,String(v)])));setData(j);
   // A saved order for this week comes back with its quantities and Jev's choices.
   if(j.order){setFinal(Object.fromEntries(j.order.lines.map(l=>[l.metro+'|'+l.sku,l.qty])));setDecisions(Object.fromEntries(j.order.lines.filter(l=>l.jevQty!==null).map(l=>[l.metro+'|'+l.sku,{qty:l.jevQty,confidence:l.confidence,source:'jev',saved:true}])));}
   setScope(old=>old&&j.lines.some(l=>l.metro===old)?old:j.lines[0]?.metro||'');
  }catch(e){setError(e.message);}
 }
 useEffect(()=>{load();},[]);
 const lines=data?.lines||[],metros=useMemo(()=>[...new Set(lines.map(l=>l.metro))],[lines]);
 const qtyOf=l=>final[l.key]??decisions[l.key]?.qty??l.base;
 async function upload(file){
  if(!file)return;setBusy('import');setError('');setNotice('');
  try{const {rows,skipped,hasStock}=await readSalesFile(file.name,await file.arrayBuffer());
   const j=await api('',{action:'import',rows,filename:file.name});
   setNotice(`${j.lines} lignes Metro × produit × semaine importées${skipped?` · ${skipped} lignes illisibles ignorées`:''}${hasStock?'':' · pas de colonne de stock : les quantités remplacent les ventes'}.`);await load();
  }catch(e){setError(e.message);}finally{setBusy('');}
 }
 async function decide(){
  setBusy('jev');setError('');setNotice('');
  const todo=lines.filter(l=>!scope||l.metro===scope),next={...decisions};
  try{for(let i=0;i<todo.length;i+=CHUNK){setProgress({done:i,total:todo.length});
    const j=await api('',{action:'decide',settings,keys:todo.slice(i,i+CHUNK).map(l=>l.key)});
    for(const d of j.decisions)next[d.key]=d;setDecisions({...next});}
   setFinal(f=>Object.fromEntries(Object.entries(f).filter(([k])=>!todo.some(l=>l.key===k))));
   const fallback=todo.filter(l=>next[l.key]?.source==='regle'&&next[l.key]?.note).length;
   setNotice(fallback?`Jev n’a pas répondu pour ${fallback} ligne${fallback>1?'s':''} : ${next[todo.find(l=>next[l.key]?.note).key].note} La règle est appliquée.`:`Jev a choisi les quantités de ${todo.length} lignes.`);
  }catch(e){setError(e.message);}finally{setBusy('');setProgress(null);}
 }
 async function save(){
  setBusy('save');setError('');
  try{const j=await api('',{action:'save',order:{week:data.week,settings,lines:lines.map(l=>({metro:l.metro,sku:l.sku,product:l.product,qty:qtyOf(l),base:l.base,jevQty:decisions[l.key]?.source==='jev'?decisions[l.key].qty:null,confidence:decisions[l.key]?.source==='jev'?decisions[l.key].confidence:null}))}});
   setNotice('Commande de la semaine du '+dateLabel(data.week)+' enregistrée.');setData(d=>({...d,order:{...(d.order||{}),savedAt:j.savedAt}}));
  }catch(e){setError(e.message);}finally{setBusy('');}
 }
 const picker=<label className={'quiet-button monthly-upload'+(busy==='import'?' busy':'')}>{busy==='import'?'Lecture…':lines.length?'Importer des ventes':'Importer un fichier de ventes'}<input type="file" hidden disabled={!!busy} onChange={e=>{upload(e.target.files?.[0]);e.target.value='';}}/></label>;
 const shown=lines.filter(l=>l.metro===scope&&(!onlyReview||decisions[l.key]?.review||l.urgency!=='normale'));
 const totals=metros.map(m=>{const list=lines.filter(l=>l.metro===m);return {metro:m,lines:list.filter(l=>qtyOf(l)>0).length,units:list.reduce((n,l)=>n+qtyOf(l),0),review:list.filter(l=>decisions[l.key]?.review).length,decided:list.filter(l=>decisions[l.key]).length,total:list.length};});
 const setting=(k,v)=>setSettings(s=>({...s,[k]:v}));
 return <section className="comparison metro-panel" id="metro">
  <div className="sectionhead"><div><h1>Commandes Metro{data&&<> — semaine du {dateLabel(data.week)}</>}</h1>{data?.weeks?.count>0&&<p className="footnote">Ventes du {dateLabel(data.weeks.first)} au {dateLabel(data.weeks.last)} ({data.weeks.count} semaines){data.files?.[0]&&<> · dernier fichier : {data.files[0].name}</>}. Chaque fichier remplace les semaines qu’il couvre.</p>}</div>{lines.length>0&&picker}</div>
  {error&&<p role="alert" className="alert">{error}</p>}{notice&&<p role="status" className="demo">{notice}</p>}
  {data&&!lines.length&&<div className="monthly-empty"><p>Importez les ventes des Metros (Excel ou CSV) : une ligne par Metro, produit et date (ou semaine), avec les unités vendues. Une colonne de stock et une de format de caisse, si elles existent, rendent les quantités plus justes.</p>{picker}</div>}
  {lines.length>0&&<>
   <div className="metro-controls">
    <label>Jours couverts<input type="number" min="1" max="28" step="1" value={settings.coverageDays} onChange={e=>setting('coverageDays',+e.target.value)}/></label>
    <label>Délai de livraison (j)<input type="number" min="0" max="14" step="1" value={settings.leadDays} onChange={e=>setting('leadDays',+e.target.value)}/></label>
    <label>Sécurité (×)<input type="number" min="1" max="2" step="0.05" value={settings.safety} onChange={e=>setting('safety',+e.target.value)}/></label>
    <button onClick={()=>{setDecisions({});setFinal({});load(settings);}} disabled={!!busy}>Recalculer</button>
    <button className="primary" onClick={decide} disabled={!!busy}>{busy==='jev'?`Jev décide… ${progress?.done??0} / ${progress?.total??''}`:`Faire décider Jev (${scope})`}</button>
   </div>
   {data&&!data.jev&&<p className="footnote">Jev n’est accessible qu’une fois le site publié sur Netlify (AI Gateway). Ici, la règle est appliquée à sa place.</p>}
   <div className="metro-cards">{totals.map(t=><button key={t.metro} aria-pressed={scope===t.metro} onClick={()=>setScope(t.metro)}><b>{t.metro}</b><span>{t.lines} produit{t.lines>1?'s':''} à commander · {t.units} unités</span><small>{t.decided?`Jev : ${t.decided}/${t.total}${t.review?` · ${t.review} à vérifier`:''}`:'Règle seulement'}</small></button>)}</div>
   <div className="metro-toolbar"><label className="metro-check"><input type="checkbox" checked={onlyReview} onChange={e=>setOnlyReview(e.target.checked)}/>À vérifier seulement</label>
    <span><button onClick={save} disabled={!!busy}>{busy==='save'?'Enregistrement…':'Enregistrer la commande'}</button> <button onClick={()=>download(`commande-${scope.replace(/\W+/g,'-')}-${data.week}.csv`,orderCsv(lines.map(l=>({...l,qty:qtyOf(l)})),scope))} disabled={!!busy}>Télécharger ({scope})</button></span></div>
   <div className="table-scroll"><table className="metro-table"><thead><tr><th scope="col">Produit</th><th scope="col">12 semaines<small>vert : 4 dernières</small></th><th scope="col">Rythme<small>/ sem. (4 · 12)</small></th><th scope="col">Stock</th><th scope="col">Règle</th><th scope="col">Jev<small>choix · confiance</small></th><th scope="col">À commander</th></tr></thead>
    <tbody>{shown.map(l=>{const d=decisions[l.key],q=qtyOf(l);return <tr key={l.key} className={d?.review||l.urgency!=='normale'?'metro-review':''}>
     <th scope="row">{l.product||l.sku}<small className="metro-sku">{l.sku}{l.pack>1?` · caisse de ${l.pack}`:''}</small></th>
     <td><Spark history={l.history}/></td>
     <td title={l.rule}>{l.v4.toLocaleString('fr-CA')} · {l.v12.toLocaleString('fr-CA')}<small className={'metro-trend '+l.trend}>{TREND[l.trend]}</small></td>
     <td>{l.stock===null?'—':l.stock}{l.urgency!=='normale'&&<small className="negative">{l.urgency==='rupture'?'rupture proche':'urgent'}</small>}</td>
     <td title={l.rule}>{l.base}</td>
     <td title={d?.probabilities?Object.entries(d.probabilities).map(([k,p])=>`${LABEL[k]} (${l.candidates[k]}) : ${pct(p)}`).join('\n'):d?.note||''}>{d?.source==='jev'?<><b>{d.qty}</b><span className="metro-confidence"><i style={{width:pct(d.confidence??0)}}/></span><small>{d.label?LABEL[d.label]+' · ':''}{pct(d.confidence??0)}</small></>:d?<small>règle{d.note?' (Jev indisponible)':''}</small>:'—'}</td>
     <td><input className="metro-qty" type="number" min="0" step={l.pack} value={q} aria-label={'Quantité '+(l.product||l.sku)} onChange={e=>setFinal(f=>({...f,[l.key]:Math.max(0,Math.round(+e.target.value||0))}))}/></td>
    </tr>;})}</tbody></table></div>
   {!shown.length&&<p className="footnote">Aucune ligne à vérifier pour {scope}.</p>}
   <details className="monthly-older"><summary>Comment Jev décide</summary><p className="footnote">Pour chaque produit, la règle de Vanier (outil de réappro) calcule une quantité : rythme des 4 dernières semaines × jours couverts (+ délai et sécurité si le stock est connu, moins le stock), ±15 % selon la tendance, arrondie à la caisse. Jev reçoit les 12 semaines de ventes, le stock et le calcul, puis choisit entre <b>rien</b>, <b>1 caisse de moins</b>, <b>la règle</b> et <b>1 caisse de plus</b>. Il ne rédige rien : il donne la probabilité de chaque option. Une confiance sous 60 % marque la ligne « à vérifier ». Vous gardez le dernier mot : la quantité est modifiable avant l’enregistrement.</p></details>
  </>}
 </section>;
}
