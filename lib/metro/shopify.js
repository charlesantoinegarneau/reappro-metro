// Catalog read straight from Shopify (Admin GraphQL, app « Outil commandes
// CAG », read_products + read_inventory): brand, product, variant, barcode and
// unit cost of every variant. Read only; the token lives in the Netlify
// environment variable SHOPIFY_ADMIN_ACCESS_TOKEN and is never sent anywhere else.
import {barcodeKey} from './catalog.js';

export const SHOPIFY_DOMAIN='shopsantesupplements.myshopify.com';
export const SHOPIFY_VERSION='2026-07';
// 250 variants per page (Shopify's maximum): about 21 pages for the whole
// catalog, one page per request so each stays far inside the function limit.
export const CATALOG_QUERY=`query MetroCatalog($cursor:String){productVariants(first:250,after:$cursor){nodes{
 barcode selectedOptions{name value} product{title vendor} inventoryItem{unitCost{amount currencyCode}}
}pageInfo{hasNextPage endCursor}}}`;

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function shopifyClient(token,{domain=SHOPIFY_DOMAIN,version=SHOPIFY_VERSION,request=fetch,wait=pause}={}){
 return async function gql(query,variables={}){
  if(!token)throw Error('Connexion Shopify non configurée (variable SHOPIFY_ADMIN_ACCESS_TOKEN).');
  for(let attempt=0;attempt<4;attempt++){
   const r=await request(`https://${domain}/admin/api/${version}/graphql.json`,{method:'POST',headers:{'X-Shopify-Access-Token':token,'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(20000)});
   if(r.status===429){await wait(500*2**attempt);continue;}
   if(r.status===401||r.status===403)throw Error('Shopify refuse l’accès : jeton révoqué ou portée read_products / read_inventory manquante.');
   if(!r.ok)throw Error('Shopify indisponible (HTTP '+r.status+'). Réessayez.');
   const j=await r.json();
   if(j.errors?.some(e=>e.extensions?.code==='THROTTLED')){await wait(500*2**attempt);continue;}
   if(j.errors?.some(e=>e.extensions?.code==='ACCESS_DENIED'))throw Error('Shopify refuse l’accès : portée read_products ou read_inventory manquante.');
   if(j.errors?.length||!j.data)throw Error('Lecture Shopify refusée ou incomplète.');
   return j.data;
  }
  throw Error('Limite Shopify atteinte. Réessayez dans un instant.');
 };
}
// One page → {items: {barcode: {brand, product, variant, cost}}, next}.
// Variants without a barcode cannot be matched to Metro's reports: skipped.
export async function catalogPage(gql,cursor=null){
 const page=(await gql(CATALOG_QUERY,{cursor})).productVariants,items={};
 for(const v of page.nodes){
  const code=barcodeKey(v.barcode);if(!code||!v.product)continue;
  const variant=(v.selectedOptions||[]).map(o=>o.value).filter(x=>x&&x!=='Default Title').join(' / ');
  const cost=v.inventoryItem?.unitCost,amount=cost&&cost.currencyCode==='CAD'?Number(cost.amount):null;
  items[code]={brand:v.product.vendor||'Autre',product:v.product.title,variant,cost:Number.isFinite(amount)&&amount>=0?amount:null};
 }
 return {items,next:page.pageInfo.hasNextPage?page.pageInfo.endCursor:null};
}
