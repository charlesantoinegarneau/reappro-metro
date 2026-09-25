// Spreadsheet reading shared by the browser and the server: CSV lines,
// text repair and a minimal .xlsx reader.
// Text saved as UTF-8 but read as Latin-1 ("SantÃ©") is restored.
export function repairText(s){
 if(!/Ã./.test(s)||[...s].some(c=>c.charCodeAt(0)>255))return s;
 try{return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(s,c=>c.charCodeAt(0)));}catch{return s;}
}
export function splitCsv(line,separator=','){
 const out=[];let cell='',quote=false;
 for(let i=0;i<line.length;i++){const c=line[i];
  if(quote){if(c==='"'&&line[i+1]==='"'){cell+='"';i++;}else if(c==='"')quote=false;else cell+=c;}
  else if(c==='"')quote=true;else if(c===separator){out.push(cell);cell='';}else cell+=c;}
 out.push(cell);return out;
}

// Minimal .xlsx reader: ZIP central directory + inflate (DecompressionStream,
// available in browsers and Node) + the first worksheet's cells.
const decodeXml=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&amp;/g,'&');
async function unzip(buffer){
 const bytes=new Uint8Array(buffer),view=new DataView(buffer),files=new Map();
 let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
 if(eocd<0)throw Error('Fichier Excel illisible.');
 let p=view.getUint32(eocd+16,true);const count=view.getUint16(eocd+10,true);
 for(let n=0;n<count;n++){
  if(view.getUint32(p,true)!==0x02014b50)throw Error('Fichier Excel illisible.');
  const method=view.getUint16(p+10,true),size=view.getUint32(p+20,true),nameLength=view.getUint16(p+28,true),skip=nameLength+view.getUint16(p+30,true)+view.getUint16(p+32,true),local=view.getUint32(p+42,true);
  const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+nameLength)),start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
  files.set(name,{method,data:bytes.subarray(start,start+size)});p+=46+skip;
 }
 return async name=>{const f=files.get(name);if(!f)return null;
  const raw=f.method===0?f.data:new Uint8Array(await new Response(new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  return new TextDecoder().decode(raw);};
}
export async function readXlsx(buffer){
 const read=await unzip(buffer),shared=[];
 const strings=await read('xl/sharedStrings.xml');
 if(strings)for(const si of strings.match(/<si>[\s\S]*?<\/si>/g)||[])shared.push(decodeXml((si.match(/<t[^>]*>[\s\S]*?<\/t>/g)||[]).map(t=>t.replace(/<[^>]+>/g,'')).join('')));
 const sheet=await read('xl/worksheets/sheet1.xml');if(!sheet)throw Error('Feuille introuvable dans le fichier Excel.');
 const table=[];
 for(const row of sheet.match(/<row[\s\S]*?<\/row>/g)||[]){
  const cells=[];
  for(const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)||[]){
   const ref=/r="([A-Z]+)\d+"/.exec(c)?.[1]||'A',column=[...ref].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1,type=/t="(\w+)"/.exec(c)?.[1],value=/<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
   cells[column]=type==='s'?shared[+value]:type==='inlineStr'?decodeXml((c.match(/<t[^>]*>[\s\S]*?<\/t>/g)||[]).map(t=>t.replace(/<[^>]+>/g,'')).join('')):value===undefined?'':decodeXml(value);
  }
  table.push(Array.from(cells,c=>c??''));
 }
 return table;
}
