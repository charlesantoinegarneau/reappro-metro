// D1-shaped statements over Postgres: `?` placeholders, first/all/run and a
// transactional batch, so the route code keeps its original structure.
// `connect` returns a client with query(text, params) and release().
export const toPostgres=sql=>{let i=0;return sql.replace(/\?/g,()=>'$'+(++i));};
export function createDatabase(connect){
 async function exec(sql,args){const client=await connect();try{return await client.query(toPostgres(sql),args);}finally{client.release();}}
 const result=r=>({results:r.rows,meta:{changes:r.rowCount??0}});
 const statement=(sql,args=[])=>({sql,args,
  bind:(...values)=>statement(sql,values),
  first:async()=>(await exec(sql,args)).rows[0]??null,
  all:async()=>result(await exec(sql,args)),
  run:async()=>result(await exec(sql,args))});
 return {
  prepare:sql=>statement(sql),
  // All statements commit together or not at all, like a D1 batch.
  async batch(list){
   const client=await connect();
   try{await client.query('BEGIN');const out=[];for(const s of list)out.push(result(await client.query(toPostgres(s.sql),s.args)));await client.query('COMMIT');return out;}
   catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
   finally{client.release();}
  }
 };
}
