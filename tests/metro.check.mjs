import test from 'node:test';import assert from 'node:assert/strict';
import {combineFiles,detectColumns,mergeSales,parseDate,parseNumber,parseSalesTable,readSalesFile,validateSalesRows,weekOf} from '../lib/metro/sales.js';
import {candidates,planLines,planWeek,validSettings} from '../lib/metro/plan.js';
import {decideLines,jevRequest} from '../lib/metro/jev.js';
import {orderCsv,validOrder} from '../lib/metro/order.js';
import {testDatabase} from './pg.mjs';
const S={coverageDays:7,leadDays:3,safety:1.25},TODAY='2026-09-25';
// Fictitious Metro sales: 12 circular weeks (Thursday to Wednesday), the last from Sep 17 to 23 2026.
const WEEKS=Array.from({length:12},(_,i)=>{const d=new Date(Date.UTC(2026,6,2+i*7));return d.toISOString().slice(0,10);});
const row=(metro,sku,week,units,extra={})=>({metro,sku,product:'Produit '+sku,week,units,days:7,stock:null,pack:null,...extra});

test('lecture : CSV à point-virgule, titre, dates québécoises, nombres à virgule, semaines',async()=>{
 assert.equal(weekOf('2026-09-25'),'2026-09-24');assert.equal(weekOf('2026-09-24'),'2026-09-24');assert.equal(weekOf('2026-09-23'),'2026-09-17');assert.equal(weekOf('2026-09-30'),'2026-09-24');
 assert.equal(parseDate('14/09/2026'),'2026-09-14');assert.equal(parseDate('17.09.2026'),'2026-09-17');assert.equal(parseDate('2026-09-14 00:00:00'),'2026-09-14');assert.equal(parseDate('46279'),'2026-09-14');assert.equal(parseDate('2026-02-30'),null);
 assert.equal(parseNumber('1 234,5'),1234.5);assert.equal(parseNumber('1,234'),1.234);assert.equal(parseNumber('1234.5'),1234.5);assert.equal(parseNumber(''),null);
 assert.deepEqual(detectColumns(['Magasin','UPC','Description','Qté vendue','Date','Inventaire','Format caisse']),{metro:0,sku:1,product:2,units:3,date:4,stock:5,pack:6});
 const csv=['Rapport des ventes Metro;;;;;','Magasin;UPC;Description;Qté vendue;Date;Inventaire;Format caisse',
  'Metro Charlesbourg;abc-1;Protéine vanille;2;14/09/2026;5;6','Metro Charlesbourg;ABC-1;Protéine vanille;1,5;16/09/2026;3;6','Metro Charlesbourg;ABC-2;Barres;4;15/09/2026;;','Total;;;7,5;;;','Metro Charlesbourg;ABC-3;Oubli;;15/09/2026;;'].join('\n');
 const {rows,skipped,hasStock}=await readSalesFile('v.csv',new TextEncoder().encode(csv).buffer);
 assert.equal(hasStock,true);assert.equal(skipped,2);
 assert.deepEqual(rows.find(r=>r.sku==='ABC-1'),{metro:'Metro Charlesbourg',sku:'ABC-1',product:'Protéine vanille',week:'2026-09-10',units:3.5,days:3,stock:3,pack:6});
 assert.throws(()=>parseSalesTable([['Nom','Montant'],['a','1']]),/Colonnes introuvables : Metro \(magasin\), SKU ou UPC, Unités vendues, Date ou semaine/)});

// Metro's weekly report layout (SAP BW export), fictitious lines, UTF-16 big-endian with a byte order mark.
function metroReport(lines){
 const q=v=>'"'+v+'"',text=['Ventes Shop Santé','Dernière MàJ des données :','24.09.2026 04:15:30','"";"";"";"";"";"";"";"";"";"Quantité";"Poids";"Ventes $"',
  ['Semaine circulaire','Jour calendaire','Client','Client','EAN/UPC','Article','Article','Gamme','Indicateur de poids','PC','','CAD'].map(q).join(';'),
  ...lines.map(([day,client,name,upc,desc,qty,amount])=>['52.2026',day,client,name,upc,'10160000',desc,'YMT141','NON',qty,'0',amount].map(q).join(';'))].join('\r\n')+'\r\n';
 const bytes=new Uint8Array(2+text.length*2);bytes[0]=0xfe;bytes[1]=0xff;
 for(let i=0;i<text.length;i++){bytes[2+2*i]=text.charCodeAt(i)>>8;bytes[3+2*i]=text.charCodeAt(i)&255;}
 return bytes.buffer;
}
test('rapport Metro : UTF-16, en-tête sur deux lignes, Metro selon le code client, jours présents',async()=>{
 const {rows,skipped}=await readSalesFile('ZRT_ZMPOSJ21_SHOPSANTE_01_00000.CSV',metroReport([
  ['17.09.2026','22658','MARCHE INNOVATION INC.','0000000000017','SS PROTÉINE TEST 454G','2','69,98'],
  ['18.09.2026','22658','MARCHE INNOVATION INC.','0000000000017','SS PROTÉINE TEST 454G','1','34,99'],
  ['22.09.2026','22658','MARCHE INNOVATION INC.','0000000000024','SS BARRE TEST 60G','3','8,97'],
  ['20.09.2026','99999','MARCHE NOUVEAU INC.','0000000000017','SS PROTÉINE TEST 454G','0','-12,50']]));
 assert.equal(skipped,0);
 assert.deepEqual(rows.find(r=>r.metro==='Innovation'&&r.sku==='0000000000017'),{metro:'Innovation',sku:'0000000000017',product:'SS PROTÉINE TEST 454G',week:'2026-09-17',units:3,days:3,stock:null,pack:null});
 assert.equal(rows.find(r=>r.metro==='Marche Nouveau Inc.').units,0,'client inconnu : son nom, pas son code');
 // Missing days are scaled to 7 in the rhythm; a Metro's opening weeks are left out.
 const S7=[...WEEKS.slice(-8)];
 const lines=planLines([...S7.map((w,i)=>row('A','X',w,i===6?6:7,{days:i===6?6:7})),...S7.slice(-5).map((w,i)=>row('N','X',w,i===0?1:7))],S,TODAY);
 const a=lines.find(l=>l.metro==='A');assert.equal(a.v4,7);assert.equal(a.history[6].days,6);
 const n=lines.find(l=>l.metro==='N');assert.equal(n.history.length,4,'semaine d’ouverture écartée');assert.equal(n.v4,7)});

test('fusion : un fichier remplace les semaines qu’il couvre, 26 semaines conservées',()=>{
 const old=[row('A','X','2026-09-10',5),row('A','X','2026-09-17',9),row('B','X','2026-09-17',2)];
 const merged=mergeSales(old,[row('A','Y','2026-09-17',1)]);
 assert.deepEqual(merged.map(r=>[r.metro,r.sku,r.week]),[['A','X','2026-09-10'],['A','Y','2026-09-17'],['B','X','2026-09-17']]);
 assert.equal(mergeSales([row('A','X','2026-01-08',1)],[row('A','X','2026-09-17',1)]).length,1);
 assert.throws(()=>validateSalesRows([row('A','X','2026-09-14',1)]),/invalide/,'une semaine commence un jeudi');
 assert.throws(()=>validateSalesRows([row('A','X','2026-09-17',1),row('A','X','2026-09-17',2)]),/double/);
 // Several files: a later one replaces the Metro-weeks an earlier one covered.
 assert.deepEqual(combineFiles([{rows:[row('A','X','2026-09-17',5),row('A','Y','2026-09-17',1),row('B','X','2026-09-17',2)]},{rows:[row('A','X','2026-09-17',6)]}]).map(r=>[r.metro,r.sku,r.units]),[['B','X',2],['A','X',6]])});

test('règle : rythme, tendance, stock, caisse, semaine en cours exclue, semaine absente ≠ zéro',()=>{
 assert.equal(planWeek(TODAY),'2026-10-01');assert.equal(planWeek('2026-10-01'),'2026-10-08');assert.equal(planWeek('2026-09-30'),'2026-10-01');
 assert.throws(()=>validSettings({...S,coverageDays:0}));
 const rows=[
  // Steady 7 / week, stock known (4), cases of 6: 1/day × 10 d × 1.25 − 4 = 8.5 → 12.
  ...WEEKS.map(w=>row('A','STEADY',w,7,{stock:4,pack:6})),
  // Rising: 2 / week then 10 / week over the last 4 weeks, no stock: rhythm (10 + 4.67) / 2 = 7.33 × 1.15 = 8.4 → 8 (nearest).
  ...WEEKS.map((w,i)=>row('A','RISING',w,i>=8?10:2)),
  // Sold once long ago: nothing recent.
  row('A','OLD',WEEKS[0],0),
  // The current week (not finished) is ignored.
  row('A','STEADY','2026-09-24',100,{stock:4,pack:6}),
  // Metro B only covers 2 weeks: its history has 2 weeks, not 12 zeros.
  row('B','STEADY',WEEKS[10],14),row('B','STEADY',WEEKS[11],14)];
 const lines=planLines(rows,S,TODAY),get=(m,s)=>lines.find(l=>l.metro===m&&l.sku===s);
 const steady=get('A','STEADY');
 assert.equal(steady.week,'2026-10-01');assert.equal(steady.history.length,12);assert.equal(steady.v4,7);assert.equal(steady.trend,'stable');assert.equal(steady.stock,4);assert.equal(steady.base,12);
 assert.deepEqual(steady.candidates,{aucune:0,reduite:6,regle:12,hausse:18});assert.equal(steady.urgency,'urgente','stock 4 < 2 × délai 3 j × 1 / j');
 const rising=get('A','RISING');assert.equal(rising.trend,'hausse');assert.equal(rising.stock,null);assert.equal(rising.base,8);assert.match(rising.rule,/stock inconnu/);
 const old=get('A','OLD');assert.equal(old.base,0);assert.deepEqual(old.candidates,{aucune:0});
 const b=get('B','STEADY');assert.equal(b.history.length,2);assert.equal(b.v4,14);assert.equal(b.base,14);
 assert.equal(planLines([...WEEKS.map(w=>row('C','LOW',w,14,{stock:1}))],S,TODAY)[0].urgency,'rupture');
 assert.deepEqual(candidates(0,6,true),{aucune:0,hausse:6})});

const fakeJev=(answer)=>({calls:[],async systemOne(request,options){this.calls.push({request,options});return {model:'jev-test',usage:{input_tokens:1,output_tokens:1},answers:answer(request)};}});
test('Jev : une question « choice » par ligne, probabilités, confiance faible à vérifier, repli sur la règle',async()=>{
 const rows=[...WEEKS.map(w=>row('A','STEADY',w,7,{stock:4,pack:6})),...WEEKS.map(w=>row('A','NEW',w,w===WEEKS[11]?6:0)),row('A','OLD',WEEKS[0],0)];
 const lines=planLines(rows,S,TODAY),asked=lines.filter(l=>Object.keys(l.candidates).length>1);
 const {state,questions}=jevRequest(asked,S);
 assert.equal(Object.keys(questions).length,2);assert.equal(questions.l0.type,'choice');
 assert.deepEqual(Object.keys(questions[Object.keys(questions).find(k=>state.lignes[k].sku==='STEADY')].criteria),['aucune','reduite','regle','hausse']);
 assert.match(questions.l0.criteria.aucune,/^0 unité/);assert.equal(state.parametres.jours_couverts,7);assert.equal(state.lignes.l0.ventes_hebdo.length,12);
 const jev=fakeJev(req=>Object.fromEntries(Object.keys(req.questions).map(k=>req.state.lignes[k].sku==='STEADY'
  ?[k,{type:'choice',choice:'hausse',confidence:.8,probabilities:{aucune:0,reduite:.05,regle:.15,hausse:.8}}]
  :[k,{type:'choice',choice:'regle',confidence:.45,probabilities:{aucune:.3,regle:.45,hausse:.25}}])));
 const decisions=await decideLines(jev,lines,S),by=Object.fromEntries(decisions.map(d=>[d.key.split('|')[1],d]));
 assert.equal(jev.calls.length,1,'une seule requête pour le lot');assert.equal(jev.calls[0].options.timeout,25000);
 assert.equal(by.STEADY.qty,18);assert.equal(by.STEADY.source,'jev');assert.equal(by.STEADY.review,false);assert.equal(by.STEADY.expected,16.5);
 assert.equal(by.NEW.review,true,'confiance sous 60 %');
 assert.deepEqual([by.OLD.qty,by.OLD.source,by.OLD.review],[0,'regle',false],'rien vendu : pas de question');
 // Jev unavailable or an answer outside the options: the rule applies, marked for review.
 const down=await decideLines({systemOne:async()=>{throw Error('panne');}},lines,S);
 assert.deepEqual(down.filter(d=>d.source==='regle'&&d.review).map(d=>[d.qty,d.note]),[[1,'panne'],[12,'panne']]);
 const none=await decideLines(null,lines,S);assert.match(none[0].note,/pas configuré/);
 const odd=await decideLines(fakeJev(req=>Object.fromEntries(Object.keys(req.questions).map(k=>[k,{type:'choice',choice:'autre',confidence:1,probabilities:{}}]))),lines,S);
 assert.ok(odd.filter(d=>Object.keys(lines.find(l=>l.key===d.key).candidates).length>1).every(d=>d.source==='regle'&&d.review))});

test('commande : validation, CSV par Metro, enregistrement par semaine',async()=>{
 const order={week:'2026-10-01',settings:S,lines:[{metro:'A',sku:'X',product:'Protéine, vanille',qty:12,base:12,jevQty:18,confidence:.8},{metro:'A',sku:'Y',product:'',qty:0},{metro:'B',sku:'X',product:'P',qty:6}]};
 const valid=validOrder(order,'2026-10-01');assert.equal(valid.lines[1].jevQty,null);
 assert.throws(()=>validOrder(order,'2026-10-08'),/semaine/);assert.throws(()=>validOrder({...order,lines:[{metro:'A',sku:'X',qty:1.5}]},'2026-10-01'));
 assert.equal(orderCsv(valid.lines,'A'),'SKU,Produit,Quantité\nX,"Protéine, vanille",12\n');
 const t=await testDatabase(),save=doc=>t.db.prepare('INSERT INTO metro_orders(user_id,week,document,saved_at) VALUES(?,?,?,?) ON CONFLICT(user_id,week) DO UPDATE SET document=excluded.document,saved_at=excluded.saved_at').bind('owner',doc.week,JSON.stringify(doc),new Date().toISOString()).run();
 await save(valid);await save({...valid,lines:valid.lines.slice(0,1)});
 assert.equal(JSON.parse((await t.db.prepare('SELECT document FROM metro_orders WHERE user_id=? AND week=?').bind('owner','2026-10-01').first()).document).lines.length,1);
 await t.db.prepare('INSERT INTO metro_sales(user_id,document,imported_at) VALUES(?,?,?)').bind('owner','{"rows":[]}','x').run();await t.close()});
