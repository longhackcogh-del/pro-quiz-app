const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('Batch actions: confirm/delete preserve account boundaries and never partially accept foreign IDs',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'quiz-bulk-'));process.env.DATABASE_FILE=path.join(directory,'test.sqlite');
 const {loadAuthenticatedApp,authenticatedFetch}=require('./auth-client');const app=loadAuthenticatedApp(),db=require('../server/database');const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('quiz-bulk-'))throw Error('Unexpected cleanup path');fs.rmSync(target,{recursive:true,force:true});});
 const a=await authenticatedFetch(base),b=await authenticatedFetch(base,'bulk-other','other@example.com');
 const req=async(f,url,body)=>{const r=await f(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const draft={prompt:'Pending',options:['a','b','c','d']};const own=(await req(a,'/api/questions/import',{questions:[draft,draft]})).data.imported;const foreign=(await req(b,'/api/questions/import',{questions:[draft]})).data.imported[0];
 assert.equal((await req(a,'/api/questions/bulk-confirm',{questions:[{id:own[0].id,answerIndex:2},{id:foreign.id,answerIndex:1}]})).status,404);
 assert.equal(db.prepare('SELECT answer_index FROM questions WHERE id=?').get(own[0].id).answer_index,null);
 const confirmed=await req(a,'/api/questions/bulk-confirm',{questions:own.map((q,index)=>({id:q.id,answerIndex:index}))});assert.equal(confirmed.data.confirmed,2);
 assert.equal((await req(a,'/api/questions/bulk-confirm',{questions:[{id:own[0].id,answerIndex:3}]})).data.confirmed,0);assert.equal(db.prepare('SELECT answer_index FROM questions WHERE id=?').get(own[0].id).answer_index,0);
 assert.equal((await req(a,'/api/questions/bulk-delete',{questionIds:[own[0].id,foreign.id]})).status,404);assert.ok(db.prepare('SELECT id FROM questions WHERE id=?').get(own[0].id));
 assert.equal((await req(a,'/api/questions/bulk-confirm',{questions:[{id:own[0].id,answerIndex:8}]})).status,400);
 const deleted=await req(a,'/api/questions/bulk-delete',{questionIds:own.map(q=>q.id)});assert.equal(deleted.data.deleted,2);assert.ok(db.prepare('SELECT id FROM questions WHERE id=?').get(foreign.id));
});
