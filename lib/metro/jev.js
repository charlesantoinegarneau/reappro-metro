// Jev (TypeSafe, through the Netlify AI Gateway) chooses each line's quantity
// among the rule's alternatives and gives the probability of each one.
// Jev does not write text: it answers typed questions with calibrated
// probabilities, so the rules supply the options and Jev weighs them.
import {choice} from '@typesafe-ai/sdk';

export const CHUNK=20;
// Below this confidence the line is marked for a second look.
export const REVIEW_BELOW=.6;
const DESCRIPTIONS={
 aucune:q=>`${q} unité : ne rien commander cette semaine (ventes nulles, produit en fin de vie ou stock suffisant).`,
 reduite:q=>`${q} unités : un peu moins que la règle (ventes en baisse, semaine exceptionnelle à ne pas reconduire, stock encore bon).`,
 regle:q=>`${q} unités : la quantité calculée par la règle.`,
 hausse:q=>`${q} unités : un peu plus que la règle (ventes en hausse, risque de rupture, dernière semaine sous le rythme normal par manque de stock).`
};
const RULES=['Shop Santé réapprovisionne chaque semaine les rayons de suppléments de quatre Metros (Innovation, St-Augustin, St-Nicolas, Ste-Foy). Les semaines vont du jeudi au mercredi, comme les rapports de ventes de Metro.',
 'Les ventes par produit sont faibles (souvent 0 à 3 unités par semaine) : une semaine isolée n’est pas une tendance. Le stock en rayon n’est pas connu.',
 'Une semaine à zéro est marquée « rupture probable » quand ce zéro était très improbable au rythme du produit : « reseau » si aucun Metro ne l’a vendu cette semaine-là (probable rupture chez le fournisseur, BO), « magasin » si seul ce Metro ne l’a pas vendu (rayon vide probable). Ces semaines sont écartées du rythme. Après une rupture, le rayon est à regarnir : ne pas réduire la commande pour autant; si la rupture réseau touche la dernière semaine, le produit est peut-être encore en BO.',
 'Une semaine avec des journées absentes du rapport (jour férié, rapport extrait avant la fin de la journée) est ramenée à 7 jours dans le rythme; jours_de_vente indique combien de jours le rapport contenait.',
 'La règle couvre la période de commande au rythme moyen des 4 dernières semaines et de toutes les semaines, en unités exactes (stock connu : délai de livraison et sécurité compris, moins le stock). « Un peu moins » et « un peu plus » s’écartent de la règle d’environ 15 % (au moins 1 unité).',
 'Tendance (à partir de 12 unités vendues) : « hausse » si le rythme des 4 dernières semaines dépasse 1,3 fois celui de toutes les semaines (+15 %), « baisse » s’il est sous 0,7 fois (−15 %).',
 'Les semaines sont les plus anciennes d’abord. Une semaine isolée très forte (promotion, livraison initiale) ne doit pas être reconduite; une rupture de stock (0 vendu entre de bonnes semaines) ne signifie pas que la demande a disparu.',
 'Éviter la rupture est plus important que d’éviter quelques unités de trop, sauf pour un produit sans ventes récentes.',
 'Le coût unitaire (cout_unitaire, en $) et la valeur de chaque option (valeur_options) indiquent ce qu’une erreur coûte : pour un produit cher qui se vend lentement, des unités de trop immobilisent beaucoup d’argent et reste longtemps en rayon; pour un produit peu cher qui se vend bien, la rupture coûte plus que le surplus. Coût inconnu : ne pas en tenir compte.',
 'stock est le nombre d’unités en rayon au Metro (fichier de stock), null s’il est inconnu ou négatif (erreur d’inventaire). chances_de_couvrir donne, pour chaque option, la probabilité que le rayon plus la quantité commandée suffisent jusqu’à la prochaine livraison (sans stock connu : la quantité seule, borne prudente). Viser environ 80 à 90 % pour un produit peu cher qui se vend bien, moins pour un produit cher et lent; au-delà, chaque point coûte beaucoup d’unités.',
 'rythme_reseau donne le rythme moyen du même produit dans les autres Metros : à ce Metro, quelques unités par semaine varient beaucoup; le réseau aide à juger si une semaine faible ou forte est du bruit.'];

export function jevRequest(lines,settings){
 const state={contexte:RULES,parametres:{jours_couverts:settings.coverageDays,delai_livraison_jours:settings.leadDays,multiplicateur_securite:settings.safety},lignes:{}},questions={};
 lines.forEach((l,i)=>{
  const id='l'+i;
  state.lignes[id]={metro:l.metro,marque:l.brand,produit:l.product||l.sku,sku:l.sku,semaine_commandee:l.week,ventes_hebdo:l.history.map(h=>h.units),jours_de_vente:l.history.map(h=>h.days),rupture_probable:l.history.map(h=>h.rupture||'non'),rythme_4_sem:l.v4,rythme_toutes_sem:l.v12,tendance:l.trend,stock:l.stock,urgence:l.urgency,calcul:l.rule,chances_de_couvrir:l.coverage?Object.fromEntries(Object.entries(l.coverage).map(([k,p])=>[k,Math.round(p*100)+' %'])):null,stock_date:l.stockAsOf||null,cout_unitaire:l.cost??null,valeur_options:l.cost==null?null:Object.fromEntries(Object.entries(l.candidates).map(([k,q])=>[k,Math.round(q*l.cost*100)/100])),rythme_reseau:l.network?{autres_metros:l.network.metros,unites_par_semaine:l.network.rhythm}:null};
  questions[id]=choice(`Ligne ${id} (${l.metro}, ${l.product||l.sku}) : quelle quantité commander pour la semaine du ${l.week}?`,Object.fromEntries(Object.entries(l.candidates).map(([k,q])=>[k,DESCRIPTIONS[k](q)])));
 });
 return {state,questions};
}

// Lines with a single possible answer (nothing sold, nothing to order) skip Jev.
export async function decideLines(client,lines,settings){
 const asked=lines.filter(l=>Object.keys(l.candidates).length>1),out=new Map();
 for(const l of lines)if(!asked.includes(l))out.set(l.key,{key:l.key,label:'aucune',qty:0,confidence:1,probabilities:{aucune:1},expected:0,source:'regle',review:false});
 if(asked.length){
  let answers=null,failure='';
  try{
   if(!client)throw Error('Jev n’est pas configuré (Netlify AI Gateway).');
   answers=(await client.systemOne(jevRequest(asked,settings),{timeout:25000})).answers;
  }catch(e){failure=e?.message||'Jev indisponible.';}
  asked.forEach((l,i)=>{
   const a=answers?.['l'+i];
   if(!a||!(a.choice in l.candidates)){
    const label=l.base>0?'regle':'aucune';
    out.set(l.key,{key:l.key,label,qty:l.candidates[label],confidence:null,probabilities:null,expected:null,source:'regle',review:true,note:failure||'Réponse de Jev incomplète : règle appliquée.'});
    return;
   }
   const probabilities=Object.fromEntries(Object.keys(l.candidates).map(k=>[k,a.probabilities[k]??0]));
   const expected=Object.entries(probabilities).reduce((n,[k,p])=>n+p*l.candidates[k],0);
   out.set(l.key,{key:l.key,label:a.choice,qty:l.candidates[a.choice],confidence:a.confidence,probabilities,expected:Math.round(expected*10)/10,source:'jev',review:a.confidence<REVIEW_BELOW});
  });
 }
 return lines.map(l=>out.get(l.key));
}
