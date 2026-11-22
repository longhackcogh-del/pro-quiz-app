const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('AI routes share flood protection and unsafe archives cannot stop the server',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'quiz-upload-safe-'));process.env.DATABASE_FILE=path.join(directory,'test.sqlite');process.env.GEMINI_API_KEY='';process.env.OPENAI_API_KEY='';process.env.GEMINI_API_URL='';process.env.QUIZ_TEACHER_ENABLED='true';
 const {loadAuthenticatedApp,authenticatedFetch}=require('./auth-client');const app=loadAuthenticatedApp(),db=require('../server/database');const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('quiz-upload-safe-'))throw Error('Unexpected cleanup path');fs.rmSync(target,{recursive:true,force:true});});
 const a=await authenticatedFetch(base),b=await authenticatedFetch(base,'safe-other','other@example.com');
 const post={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questions:[]})};
 for(let i=0;i<20;i++)assert.equal((await a(base+'/api/imports/ai-preview',post)).status,400);
 for(const url of ['/api/imports/ai-preview','/api/questions/1/ai-suggest','/api/attempts/1/questions/1/chat']){
  const result=await a(base+url,post);assert.equal(result.status,429);assert.ok(Number(result.headers.get('retry-after'))>0);
 }
 assert.equal((await b(base+'/api/imports/ai-preview',post)).status,400);
 process.env.GEMINI_API_KEY='test-only';process.env.GEMINI_API_URL='http://127.0.0.1:9/never-called';
 const hugeAI=await b(base+'/api/imports/ai-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questions:[{id:'oversized',prompt:'x'.repeat(120001),options:['a','b','c','d']}]})});
 assert.equal(hugeAI.status,413);
 const upload=async(buffer,name)=>{const form=new FormData();form.append('file',new Blob([buffer]),name);return a(base+'/api/imports/file',{method:'POST',body:form});};
 const JSZip=require('jszip'),zip=new JSZip();zip.file('huge.bin',Buffer.alloc(33*1024*1024,120));
 const packed=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});assert.ok(packed.length<100000);
 const rejected=await upload(packed,'large.docx');assert.equal(rejected.status,413);assert.ok((await rejected.json()).error.includes('chia nhỏ'));
 const invalid=await upload(Buffer.from('not a Word file'),'bad.docx');assert.equal(invalid.status,422);assert.ok(!(await invalid.json()).error.includes('node_modules'));
 const malformed=await a(base+'/api/imports/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'});assert.equal(malformed.status,400);
 const cookie=await require('./auth-client').signIn(base);
 let started,aborted;const ready=new Promise(resolve=>started=resolve),cancelled=new Promise(resolve=>aborted=resolve);
 server.once('request',req=>{req.once('aborted',aborted);started();});
 const unfinished=require('node:http').request(base+'/api/imports/file',{method:'POST',headers:{Cookie:cookie,'Content-Type':'multipart/form-data; boundary=review-boundary'}});
 unfinished.on('error',()=>{});unfinished.write('--review-boundary\r\nContent-Disposition: form-data; name="file"; filename="pending.docx"\r\nContent-Type: application/octet-stream\r\n\r\npartial');
 await ready;unfinished.destroy();await cancelled;
 const {docx,pdf}=require('./document-fixtures');assert.equal((await upload(await docx('Recovered document'),'good.docx')).status,200);assert.equal((await upload(pdf('Recovered PDF'),'good.pdf')).status,200);
 const ping=await fetch(base+'/ping');assert.equal(await ping.text(),'OK');
});
