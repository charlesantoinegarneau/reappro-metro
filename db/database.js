import {getDatabase} from '@netlify/database';
import {createDatabase} from './client.js';
// Netlify provisions the Postgres database and its connection string.
let db;
export function database(){
 if(!db){const {pool}=getDatabase();db=createDatabase(()=>pool.connect());}
 return db;
}
