// Real Postgres in memory (PGlite) with the production migrations, behind the
// same adapter the routes use.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {createDatabase} from '../db/client.js';
const dir=new URL('../netlify/database/migrations/',import.meta.url);
export const migrations=()=>readdirSync(dir).sort().map(name=>readFileSync(new URL(name+'/migration.sql',dir),'utf8'));
export async function testDatabase(){
 const pg=new PGlite();for(const sql of migrations())await pg.exec(sql);
 const client={query:async(text,params)=>{const r=await pg.query(text,params);return {rows:r.rows,rowCount:r.affectedRows??0};},release(){}};
 return {pg,db:createDatabase(async()=>client),close:()=>pg.close()};
}
