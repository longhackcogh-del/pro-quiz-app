const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {docx}=require('./document-fixtures');
test('PostgreSQL: private accounts, import, sets, grading, wrong review, rollback and durable writes',{skip:!process.env.TEST_DATABASE_URL,timeout:90000},async t=>{
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
 process.env.DATABASE_DRIVER='postgres';
 process.env.LEGACY_OWNER_EMAIL='';
 process.env.QUIZ_TEACHER_ENABLED='false';
 const {loadAuthenticatedApp,authenticatedFetch}=require('./auth-client');
 const app=loadAuthenticatedApp(),db=require('../server/database');
 await db.ready;
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const owners=['pg-test-'+randomUUID(),'pg-test-'+randomUUID()];
 t.after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  try { for(const owner of owners){
   await db.prepare('DELETE FROM attempts WHERE owner_id=?').run(owner);
   await db.prepare('DELETE FROM questions WHERE owner_id=?').run(owner);
   await db.prepare('DELETE FROM question_sets WHERE owner_id=?').run(owner);
   await db.prepare('DELETE FROM users WHERE id=?').run(owner);
  }} finally {await db.close();}
 });
 const a=await authenticatedFetch(base,owners[0],'pg-a@example.com');
 const b=await authenticatedFetch(base,owners[1],'pg-b@example.com');
 const request=async(fetcher,url,body,method='POST')=>{
  const r=await fetcher(base+url,body!==undefined?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const text=await r.text();return {status:r.status,data:text?JSON.parse(text):null};
 };
 assert.equal((await fetch(base+'/healthz')).status,200);
 assert.equal((await fetch(base+'/api/questions')).status,401);
 assert.deepEqual((await request(a,'/api/questions')).data,[]);
 assert.equal((await request(a,'/api/questions/not-an-id')).status,404);
 assert.equal((await request(a,'/api/attempts',{questionIds:[]})).status,400);
 const file=new FormData();file.append('file',new Blob([await docx('1. Test question\nA. One\nB. Two\nC. Three\nD. Four\nĐáp án: B')]),'prepared.docx');
 assert.equal((await a(base+'/api/imports/file',{method:'POST',body:file})).status,200);
 const imported=await request(a,'/api/questions/import',{questions:[{prompt:'Postgres test question',options:['One','Two','Three','Four'],answerIndex:1,confirmed:true}]});
 assert.equal(imported.status,201);
 const q=imported.data.imported[0];
 assert.equal(q.answerStatus,'confirmed');
 assert.equal((await request(b,'/api/questions/'+q.id)).status,404);
 assert.deepEqual((await request(b,'/api/questions')).data,[]);
 const set=(await request(a,'/api/question-sets',{name:'Chapter 1'})).data;
 assert.equal((await request(a,'/api/question-sets/contents/move',{questionIds:[q.id],setId:set.id},'PATCH')).status,200);
 assert.equal((await request(a,'/api/question-sets')).data[0].questionCount,1);
 assert.equal((await request(a,'/api/questions/'+q.id)).data.setId,set.id);
 assert.equal((await request(b,'/api/question-sets/'+set.id,{name:'Not allowed'},'PATCH')).status,404);
 const attempt=(await request(a,'/api/attempts',{questionIds:[q.id]})).data;
 assert.equal(attempt.total,1);
 assert.ok(attempt.questions.every(question=>!Object.hasOwn(question,'answerIndex')));
 assert.equal((await request(b,'/api/attempts/'+attempt.id)).status,404);
 assert.equal((await request(a,'/api/attempts/'+attempt.id+'/answer',{questionId:q.id,selectedIndex:0,currentIndex:0},'PATCH')).status,200);
 assert.equal((await request(a,'/api/wrong-answers')).data.length,1);
 const result=await request(a,'/api/attempts/'+attempt.id+'/submit',{});
 assert.equal(result.data.score,0);assert.equal(result.data.wrongCount,1);
 const retry=await request(a,'/api/attempts/'+attempt.id+'/retry-wrong',{});
 assert.equal(retry.data.total,1);
 assert.equal((await request(a,'/api/dashboard')).data.completedAttempts,1);
 assert.equal((await request(b,'/api/wrong-answers')).data.length,0);
 assert.equal((await request(a,'/api/attempts/'+attempt.id+'/questions/'+q.id+'/chat',{message:'Explain'})).status,403);
 assert.ok((await a(base+'/api/questions/export').then(r=>r.text())).includes(q.prompt));
 const before=(await db.prepare('SELECT COUNT(*) AS count FROM question_sets WHERE owner_id=?').get(owners[0])).count;
 await assert.rejects(db.transaction(async()=>{await db.prepare('INSERT INTO question_sets(owner_id,name) VALUES (?,?)').run(owners[0],'Rollback fixture');throw Error('rollback');}));
 assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM question_sets WHERE owner_id=?').get(owners[0])).count,before);
 // A separate connection confirms data is in PostgreSQL, not process memory.
 const {Client}=require('pg');const url=new URL(process.env.TEST_DATABASE_URL);if(url.hostname.endsWith('.neon.tech'))url.searchParams.set('sslmode','verify-full');
 const client=new Client({connectionString:url.toString()});await client.connect();
 try {assert.equal((await client.query('SELECT prompt FROM questions WHERE id=$1',[q.id])).rows[0].prompt,q.prompt);}finally{await client.end();}
 assert.equal((await request(a,'/api/question-sets/'+set.id,{},'DELETE')).status,200);
 assert.equal((await request(a,'/api/questions/'+q.id)).data.setId,null);
 const large=Array.from({length:501},(_,i)=>({prompt:'Batch PG '+i,options:['A '+i,'B '+i,'C '+i,'D '+i],answerIndex:2,confirmed:true}));
 const bulkStart=performance.now();
 const bulk=await request(a,'/api/questions/import',{questions:large});
 t.diagnostic(JSON.stringify({postgresQuestions:large.length,bulkImportMs:Math.round(performance.now()-bulkStart)}));
 assert.equal(bulk.status,201);assert.equal(bulk.data.imported.length,501);
 const all=(await request(a,'/api/questions')).data;
 for(const index of [0,499,500]) {const question=all.find(row=>row.id===bulk.data.imported[index].id);assert.equal(question.prompt,large[index].prompt);assert.deepEqual(question.options,large[index].options);}
 const largeAttempt=(await request(a,'/api/attempts',{questionIds:bulk.data.imported.map(question=>question.id)})).data;
 assert.equal(largeAttempt.total,501);
 const delta=(await request(a,'/api/attempts/'+largeAttempt.id+'/answer',{questionId:largeAttempt.questions[0].id,selectedIndex:0,currentIndex:1,compact:true},'PATCH')).data;
 assert.equal(delta.partial,true);assert.equal(delta.questions.length,2);assert.equal(delta.total,501);
 const feedbackStart=performance.now();
 const feedback=await request(a,'/api/attempts/'+largeAttempt.id+'/answer',{feedbackOnly:true,questionId:largeAttempt.questions[0].id,selectedIndex:2,currentIndex:1},'PATCH');
 assert.equal(feedback.status,200);assert.equal(feedback.data.feedback.correct,true);assert.equal(feedback.data.currentIndex,1);assert.ok(!feedback.data.questions);
 assert.equal((await request(a,'/api/attempts/'+largeAttempt.id+'/cursor',{currentIndex:0},'PATCH')).status,200);
 const resumed=(await request(a,'/api/attempts/'+largeAttempt.id)).data;
 assert.equal(resumed.currentIndex,0);assert.equal(resumed.questions[0].selectedIndex,2);
 const concurrent=await Promise.all([1,2].map(index=>request(a,'/api/attempts/'+largeAttempt.id+'/answer',{feedbackOnly:true,questionId:largeAttempt.questions[index].id,selectedIndex:2,currentIndex:index},'PATCH')));
 assert.ok(concurrent.every(r=>[200,409].includes(r.status)));
 const synchronized=(await request(a,'/api/attempts/'+largeAttempt.id)).data;
 assert.equal(synchronized.questions.filter(q=>q.selectedIndex!==null).length,1+concurrent.filter(r=>r.status===200).length);
 await db.prepare("UPDATE questions SET answer_status='unconfirmed',answer_index=NULL WHERE owner_id=? AND id IN ("+bulk.data.imported.map(()=>'?').join(',')+")").run(owners[0],...bulk.data.imported.map(q=>q.id));
 const bulkConfirmed=await request(a,'/api/questions/bulk-confirm',{questions:bulk.data.imported.map(q=>({id:q.id,answerIndex:2}))});assert.equal(bulkConfirmed.status,200);assert.equal(bulkConfirmed.data.confirmed,501);
 assert.equal((await request(b,'/api/questions/bulk-delete',{questionIds:bulk.data.imported.slice(0,2).map(q=>q.id)})).status,404);
 const bulkDeleted=await request(a,'/api/questions/bulk-delete',{questionIds:bulk.data.imported.slice(0,2).map(q=>q.id)});assert.equal(bulkDeleted.status,200);assert.equal(bulkDeleted.data.deleted,2);
 t.diagnostic(JSON.stringify({feedbackOnlyBytes:JSON.stringify(feedback.data).length,feedbackAndResumeMs:Math.round(performance.now()-feedbackStart)}));


});
