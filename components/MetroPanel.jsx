'use client';
import {Fragment,useEffect,useMemo,useState} from 'react';
import {combineFiles,readSalesFile} from '@/lib/metro/sales';
import {orderCsv} from '@/lib/metro/order';
import {readCatalogFile} from '@/lib/metro/catalog';

const CHUNK=20;
const dateLabel=d=>new Date(d+'T12:00:00Z').toLocaleDateString('fr-CA',{day:'numeric',month:'long'});
const pct=n=>Math.round(n*100)+' %';
const money=n=>new Intl.NumberFormat('fr-CA',{style:'currency',currency:'CAD',maximumFractionDigits:n>=100?0:2}).format(n);
const TREND={hausse:'↗ hausse',baisse:'↘ baisse',stable:'→ stable'};
const LABEL={aucune:'rien',reduite:'1 caisse de moins',regle:'la règle',hausse:'1 caisse de plus'};
const plain=s=>String(s??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
// Every word typed must appear in the brand, product, variant or barcode.
const matches=(l,query)=>{const text=plain([l.brand,l.name,l.variant,l.product,l.sku].join(' '));return plain(query).split(/\s+/).filter(Boolean).every(w=>text.includes(w));};
async function api(query='',body){
 const r=await fetch('/api/metro'+query,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'}),j=await r.json();
 if(!r.ok)throw Error(j.error||'Erreur');return j;
}
function download(name,text){const url=URL.createObjectURL(new Blob(['﻿'+text],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
// Twelve weeks of sales as small bars, oldest first.
function Spark({history}){
 const max=Math.max(1,...history.map(h=>h.units)),w=5,gap=2;
 if(!history.length)return null;
 return <svg className="metro-spark" width={history.length*(w+gap)} height="22" role="img" aria-label={'Ventes par semaine : '+history.map(h=>h.units+(h.days<7?' ('+h.days+' j)':'')+(h.rupture?' (rupture probable)':'')).join(', ')}>
  {history.map((h,i)=>h.rupture?<rect key={h.week} x={i*(w+gap)} y="0" width={w} height="22" rx="1" fill="#e7a64b" opacity=".45"/>:<rect key={h.week} x={i*(w+gap)} y={22-Math.max(1,h.units/max*22)} width={w} height={Math.max(1,h.units/max*22)} rx="1" fill={i>=history.length-4?'#197657':'#a9c2b3'}/>)}
 </svg>;
}

// Weekly Metro orders: the rules propose, Jev chooses, the owner validates.
export default function MetroPanel(){
 const [data,setData]=useState(null),[settings,setSettings]=useState({coverageDays:7,leadDays:3,safety:1.25}),[decisions,setDecisions]=useState({}),[final,setFinal]=useState({});
 const [scope,setScope]=useState(''),[onlyReview,setOnlyReview]=useState(false),[query,setQuery]=useState(''),[minQty,setMinQty]=useState(''),[added,setAdded]=useState([]),[busy,setBusy]=useState(''),[progress,setProgress]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function load(s=settings){
  setError('');
  try{const j=await api('?'+new URLSearchParams(Object.entries(s).map(([k,v])=>[k,String(v)])));setData(j);
   // A saved order for this week comes back with its quantities and Jev's choices.
   if(j.order){setFinal(Object.fromEntries(j.order.lines.map(l=>[l.metro+'|'+l.sku,l.qty])));setAdded(j.order.lines.filter(l=>l.manual).map(l=>({metro:l.metro,sku:l.sku})));setDecisions(Object.fromEntries(j.order.lines.filter(l=>l.jevQty!==null).map(l=>[l.metro+'|'+l.sku,{qty:l.jevQty,confidence:l.confidence,source:'jev',saved:true}])));}
   setScope(old=>old&&j.lines.some(l=>l.metro===old)?old:j.lines[0]?.metro||'');
  }catch(e){setError(e.message);}
 }
 useEffect(()=>{load();},[]);
 const planned=data?.lines||[],metros=useMemo(()=>[...new Set(planned.map(l=>l.metro))],[planned]);
 // Products added by hand to a Metro that has not sold them: same article as elsewhere in the network, quantity to set.
 const lines=useMemo(()=>{
  const have=new Set(planned.map(l=>l.key)),extra=added.filter(a=>!have.has(a.metro+'|'+a.sku)).map(a=>{const ref=planned.find(l=>l.sku===a.sku);return ref&&{...ref,key:a.metro+'|'+a.sku,metro:a.metro,history:[],v4:0,v12:0,trend:'stable',urgency:'normale',base:0,rule:'Ajout manuel : aucune vente à ce Metro.',ruptures:0,boNow:false,candidates:{aucune:0},manual:true};}).filter(Boolean);
  const by=(a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'});
  return [...planned,...extra].sort((a,b)=>by(a.metro,b.metro)||by(a.brand,b.brand)||by(a.name,b.name)||by(a.variant,b.variant)||a.sku.localeCompare(b.sku));
 },[planned,added]);
 const qtyOf=l=>final[l.key]??decisions[l.key]?.qty??l.base;
 async function upload(files){
  if(!files.length)return;setBusy('import');setError('');setNotice('');
  try{const results=[];
   for(const file of files){try{results.push(await readSalesFile(file.name,await file.arrayBuffer()));}catch(e){throw Error(file.name+' : '+e.message);}}
   const rows=combineFiles(results),skipped=results.reduce((n,r)=>n+r.skipped,0),metros=[...new Set(rows.map(r=>r.metro))].sort(),weeks=[...new Set(rows.map(r=>r.week))].sort();
   const j=await api('',{action:'import',rows,filename:files.length>1?files.length+' fichiers':files[0].name});
   setNotice(`${files.length} fichier${files.length>1?'s':''} : ${metros.join(', ')} · ${weeks.length} semaine${weeks.length>1?'s':''} (${dateLabel(weeks[0])} au ${dateLabel(weeks.at(-1))}) · ${j.lines} lignes produit × semaine${skipped?` · ${skipped} lignes illisibles ignorées`:''}${results.some(r=>r.hasStock)?'':'. Stock en rayon inconnu : les quantités remplacent les ventes'}.`);await load();
  }catch(e){setError(e.message);}finally{setBusy('');}
 }
 async function uploadCatalog(file){
  if(!file)return;setBusy('catalog');setError('');setNotice('');
  try{const items=await readCatalogFile(await file.arrayBuffer()),j=await api('',{action:'catalog',items});
   setNotice(`Catalogue Shopify importé : ${j.count} variantes avec code-barres, dont ${j.priced} avec un coût. Marques, produits, variantes et coûts viennent maintenant de Shopify quand le code-barres correspond; relancez Jev pour qu’il en tienne compte.`);await load();
  }catch(e){setError(e.message);}finally{setBusy('');}
 }
 // Whole catalog from Shopify, page by page (about 21 pages of 250 variants).
 async function syncShopify(){
  setBusy('shopify');setError('');setNotice('');
  try{let cursor=null,items={},pages=0;
   do{const j=await api('',{action:'shopify-page',cursor});Object.assign(items,j.items);cursor=j.next;pages++;setProgress({done:Object.keys(items).length,total:null,pages});}while(cursor&&pages<200);
   const j=await api('',{action:'catalog',items,source:'shopify'});
   setNotice(`Catalogue lu dans Shopify : ${j.count} variantes avec code-barres, dont ${j.priced} avec un coût. Relancez Jev pour qu’il en tienne compte.`);await load();
  }catch(e){setError(e.message);}finally{setBusy('');setProgress(null);}
 }
 async function decide(){
  setBusy('jev');setError('');setNotice('');
  const todo=planned.filter(l=>!scope||l.metro===scope),next={...decisions};
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
  try{const j=await api('',{action:'save',order:{week:data.week,settings,lines:lines.map(l=>({metro:l.metro,sku:l.sku,product:l.product,qty:qtyOf(l),base:l.base,manual:!!l.manual,jevQty:decisions[l.key]?.source==='jev'?decisions[l.key].qty:null,confidence:decisions[l.key]?.source==='jev'?decisions[l.key].confidence:null}))}});
   setNotice('Commande de la semaine du '+dateLabel(data.week)+' enregistrée.');setData(d=>({...d,order:{...(d.order||{}),savedAt:j.savedAt}}));
  }catch(e){setError(e.message);}finally{setBusy('');}
 }
 const shopifyButton=data?.shopify&&<button className="quiet-button" onClick={syncShopify} disabled={!!busy}>{busy==='shopify'?`Lecture Shopify… ${progress?.done??0} variantes`:data?.catalog?.source==='shopify'?'Actualiser le catalogue Shopify':'Lire le catalogue dans Shopify'}</button>;
 const catalogPicker=<label className={'quiet-button monthly-upload'+(busy==='catalog'?' busy':'')}>{busy==='catalog'?'Lecture…':data?.catalog?'Mettre à jour le catalogue Shopify':'Importer le catalogue Shopify'}<input type="file" accept=".csv,text/csv" hidden disabled={!!busy} onChange={e=>{uploadCatalog(e.target.files?.[0]);e.target.value='';}}/></label>;
 const picker=<label className={'quiet-button monthly-upload'+(busy==='import'?' busy':'')}>{busy==='import'?'Lecture…':lines.length?'Importer des ventes':'Importer un fichier de ventes'}<input type="file" multiple hidden disabled={!!busy} onChange={e=>{upload([...(e.target.files||[])]);e.target.value='';}}/></label>;
 const review=l=>decisions[l.key]?.review||l.urgency!=='normale'||l.boNow;
 // « À commander plus grand que x » : on the quantity kept (yours, else Jev's, else the rule's).
 const above=minQty===''?null:Number(minQty);
 // The same filters drive the list and the Metro cards' totals.
 const filtered=!!query.trim()||above!==null||onlyReview;
 const visible=l=>(!onlyReview||review(l))&&(!query.trim()||matches(l,query))&&(above===null||qtyOf(l)>above);
 const shown=lines.filter(l=>l.metro===scope&&visible(l));
 // Search also finds the network's products this Metro has never sold, to add by hand.
 const elsewhere=query.trim().length>=2?[...new Map(planned.filter(l=>l.metro!==scope&&matches(l,query)&&!lines.some(x=>x.metro===scope&&x.sku===l.sku)).map(l=>[l.sku,l])).values()].slice(0,20):[];
 const groups=[];for(const l of shown){if(groups.at(-1)?.brand!==l.brand)groups.push({brand:l.brand,lines:[]});groups.at(-1).lines.push(l);}
 const totals=metros.map(m=>{const list=lines.filter(l=>l.metro===m&&visible(l));return {metro:m,lines:list.filter(l=>qtyOf(l)>0).length,units:list.reduce((n,l)=>n+qtyOf(l),0),review:list.filter(l=>decisions[l.key]?.review).length,bo:list.filter(l=>l.boNow).length,value:list.reduce((n,l)=>n+(l.cost??0)*qtyOf(l),0),priced:list.filter(l=>qtyOf(l)>0).every(l=>l.cost!=null),decided:list.filter(l=>decisions[l.key]).length,total:list.length};});
 const setting=(k,v)=>setSettings(s=>({...s,[k]:v}));
 return <section className="comparison metro-panel" id="metro">
  <div className="sectionhead"><div><h1>Commandes Metro{data&&<> — semaine du {dateLabel(data.week)}</>}</h1>{data?.weeks?.count>0&&<p className="footnote">Ventes du {dateLabel(data.weeks.first)} au {dateLabel(data.weeks.last)} ({data.weeks.count} semaines){data.files?.[0]&&<> · dernier fichier : {data.files[0].name}</>}. Chaque fichier remplace les semaines qu’il couvre. {data.catalog?<>Catalogue Shopify ({data.catalog.source==='shopify'?'lu dans Shopify':'export CSV'}) : {data.catalog.count} variantes{data.catalog.priced?`, ${data.catalog.priced} avec coût`:''}, mis à jour le {new Date(data.catalog.importedAt).toLocaleDateString('fr-CA')}. {lines.filter(l=>l.cost!=null).length} lignes sur {lines.length} ont un coût.</>:<>Marques déduites des descriptions Metro; le catalogue Shopify donne les noms exacts et le coût de chaque produit.</>}</p>}</div>{lines.length>0&&<span className="metro-imports">{picker}{shopifyButton||catalogPicker}</span>}</div>
  {error&&<p role="alert" className="alert">{error}</p>}{notice&&<p role="status" className="demo">{notice}</p>}
  {data&&!lines.length&&<div className="monthly-empty"><p>Importez les rapports « Ventes Shop Santé » reçus de Metro chaque jeudi (fichiers ZRT_ZMPOSJ21_…CSV) : vous pouvez en sélectionner plusieurs à la fois, toutes semaines et tous Metros confondus. Tout autre fichier avec une ligne par Metro, produit et date est aussi accepté.</p>{picker}</div>}
  {lines.length>0&&<>
   <div className="metro-controls">
    <label>Jours couverts<input type="number" min="1" max="28" step="1" value={settings.coverageDays} onChange={e=>setting('coverageDays',+e.target.value)}/></label>
    <label>Délai de livraison (j)<input type="number" min="0" max="14" step="1" value={settings.leadDays} onChange={e=>setting('leadDays',+e.target.value)}/></label>
    <label>Sécurité (×)<input type="number" min="1" max="2" step="0.05" value={settings.safety} onChange={e=>setting('safety',+e.target.value)}/></label>
    <button onClick={()=>{setDecisions({});setFinal({});load(settings);}} disabled={!!busy}>Recalculer</button>
    <button className="primary" onClick={decide} disabled={!!busy}>{busy==='jev'?`Jev décide… ${progress?.done??0} / ${progress?.total??''}`:`Faire décider Jev (${scope})`}</button>
   </div>
   {data&&!data.jev&&<p className="footnote">Jev n’est accessible qu’une fois le site publié sur Netlify (AI Gateway). Ici, la règle est appliquée à sa place.</p>}
   <div className="metro-cards">{totals.map(t=><button key={t.metro} aria-pressed={scope===t.metro} onClick={()=>setScope(t.metro)}><b>{t.metro}{filtered&&<em className="metro-filtered">filtré</em>}</b><span>{t.lines} produit{t.lines>1?'s':''} à commander · {t.units} unités{t.value>0&&<> · {t.priced?'':'≥ '}{money(t.value)}</>}</span><small>{t.decided?`Jev : ${t.decided}/${t.total}${t.review?` · ${t.review} à vérifier`:''}`:'Règle seulement'}{t.bo?` · ${t.bo} en BO probable`:''}</small></button>)}</div>
   <div className="metro-search"><input type="search" placeholder={`Chercher un produit, une marque ou un code-barres (${scope})`} aria-label="Chercher un produit" value={query} onChange={e=>setQuery(e.target.value)}/>{(query||above!==null||onlyReview)&&<span>{shown.length} produit{shown.length>1?'s':''} affiché{shown.length>1?'s':''} · {shown.reduce((n,l)=>n+qtyOf(l),0)} unités</span>}</div>
   <div className="metro-toolbar"><span className="metro-filters"><label className="metro-check"><input type="checkbox" checked={onlyReview} onChange={e=>setOnlyReview(e.target.checked)}/>À vérifier seulement</label><label className="metro-min">À commander plus grand que<input type="number" min="0" step="1" inputMode="numeric" placeholder="—" value={minQty} onChange={e=>setMinQty(e.target.value===''?'':String(Math.max(0,Math.floor(+e.target.value||0))))}/>{minQty!==''&&<button className="quiet-button" onClick={()=>setMinQty('')}>Retirer</button>}</label></span>
    <span><button onClick={save} disabled={!!busy}>{busy==='save'?'Enregistrement…':'Enregistrer la commande'}</button> <button onClick={()=>download(`commande-${scope.replace(/\W+/g,'-')}-${data.week}.csv`,orderCsv(lines.map(l=>({...l,qty:qtyOf(l)})),scope))} disabled={!!busy}>Télécharger ({scope})</button></span></div>
   <div className="table-scroll"><table className="metro-table"><thead><tr><th scope="col">Produit</th><th scope="col">Semaines<small>vert : 4 dernières</small></th><th scope="col">Rythme<small>/ sem. (4 dern. · toutes)</small></th><th scope="col">Stock</th><th scope="col">Règle</th><th scope="col">Jev<small>choix · confiance</small></th><th scope="col">À commander</th></tr></thead>
    <tbody>{groups.map(g=><Fragment key={g.brand}><tr className="metro-brand"><th scope="rowgroup" colSpan={7}>{g.brand}<small>{g.lines.length} produit{g.lines.length>1?'s':''} · {g.lines.reduce((n,l)=>n+qtyOf(l),0)} unités à commander{g.lines.some(l=>l.cost!=null)&&<> · {money(g.lines.reduce((n,l)=>n+(l.cost??0)*qtyOf(l),0))}</>}</small></th></tr>{g.lines.map((l,i)=>{const d=decisions[l.key],q=qtyOf(l),same=i>0&&g.lines[i-1].name===l.name&&l.variant;return <tr key={l.key} className={review(l)?'metro-review':''}>
     <th scope="row">{same?<span className="metro-same">↳</span>:l.name}{l.variant&&<span className="metro-variant">{l.variant}</span>}<small className="metro-sku">{l.sku}{l.pack>1?` · caisse de ${l.pack}`:''}</small>{l.boNow?<small className="metro-bo">BO probable (aucun Metro ne l’a vendu la semaine dernière)</small>:l.ruptures>0&&<small className="metro-bo">{l.ruptures} semaine{l.ruptures>1?'s':''} de rupture probable</small>}{l.manual&&<small className="metro-bo">ajout manuel</small>}</th>
     <td><Spark history={l.history}/></td>
     <td title={l.rule}>{l.v4.toLocaleString('fr-CA')} · {l.v12.toLocaleString('fr-CA')}<small className={'metro-trend '+l.trend}>{TREND[l.trend]}</small></td>
     <td>{l.stock===null?'—':l.stock}{l.urgency!=='normale'&&<small className="negative">{l.urgency==='rupture'?'rupture proche':'urgent'}</small>}</td>
     <td title={l.rule}>{l.base}</td>
     <td title={d?.probabilities?Object.entries(d.probabilities).map(([k,p])=>`${LABEL[k]} (${l.candidates[k]}) : ${pct(p)}`).join('\n'):d?.note||''}>{d?.source==='jev'?<><b>{d.qty}</b><span className="metro-confidence"><i style={{width:pct(d.confidence??0)}}/></span><small>{d.label?LABEL[d.label]+' · ':''}{pct(d.confidence??0)}</small></>:d?<small>règle{d.note?' (Jev indisponible)':''}</small>:'—'}</td>
     <td><input className="metro-qty" type="number" min="0" step={l.pack} value={q} aria-label={'Quantité '+(l.product||l.sku)} onChange={e=>setFinal(f=>({...f,[l.key]:Math.max(0,Math.round(+e.target.value||0))}))}/>{l.cost!=null&&<small className="metro-cost">{money(l.cost)} / u.{q>0?' · '+money(l.cost*q):''}</small>}</td>
    </tr>;})}</Fragment>)}</tbody></table></div>
   {!shown.length&&<p className="footnote">{query?`Aucun produit vendu à ${scope} ne correspond à « ${query} ».`:above!==null?`Aucun produit de ${scope} à commander en quantité plus grande que ${above}.`:`Aucune ligne à vérifier pour ${scope}.`}</p>}
   {elsewhere.length>0&&<div className="metro-elsewhere"><h3>Vendus ailleurs dans le réseau, jamais à {scope}</h3><ul>{elsewhere.map(l=><li key={l.sku}><span><b>{l.brand}</b> {l.name}{l.variant&&' — '+l.variant}<small className="metro-sku">{l.sku}</small></span><button onClick={()=>{setAdded(a=>[...a,{metro:scope,sku:l.sku}]);setFinal(f=>({...f,[scope+'|'+l.sku]:l.pack||1}));}}>Ajouter à {scope}</button></li>)}</ul></div>}
   <details className="monthly-older"><summary>Comment Jev décide</summary><p className="footnote">Pour chaque produit, la règle de Vanier (outil de réappro) calcule une quantité : rythme moyen des 4 dernières semaines et de toutes les semaines circulaires (jeudi au mercredi; une semaine incomplète est ramenée à 7 jours, les semaines d’ouverture sont écartées) × jours couverts, ±15 % selon la tendance (à partir de 12 unités vendues), arrondie à la caisse la plus proche. Si le stock est connu : délai et sécurité compris, moins le stock, arrondie à la caisse supérieure. Une semaine à zéro très improbable au rythme du produit est une <b>rupture probable</b> (en orange dans le graphique) et n’entre pas dans le rythme : « BO » quand aucun Metro ne l’a vendu cette semaine-là, rayon vide quand seul ce Metro ne l’a pas vendu. Jev reçoit les semaines de ventes, les ruptures probables, le rythme du même produit dans les autres Metros, le coût unitaire (catalogue Shopify), le stock et le calcul, puis choisit entre <b>rien</b>, <b>1 caisse de moins</b>, <b>la règle</b> et <b>1 caisse de plus</b>. Il ne rédige rien : il donne la probabilité de chaque option. Une confiance sous 60 % marque la ligne « à vérifier ». Vous gardez le dernier mot : la quantité est modifiable avant l’enregistrement.</p></details>
  </>}
 </section>;
}
