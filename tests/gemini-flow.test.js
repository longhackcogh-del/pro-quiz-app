const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {generateGemini} = require('../server/gemini');

test('Gemini native: JSON suggestions, preserved drafts, errors, and teacher lock', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pro-quiz-gemini-'));
  process.env.DATABASE_FILE=path.join(directory,'test.sqlite');
  process.env.GEMINI_API_KEY='test-only-gemini-key';
  process.env.GEMINI_MODEL='test-model';
  process.env.QUIZ_TEACHER_ENABLED='false';
  let mode='ok';
  const calls=[];
  const provider=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const payload=JSON.parse(body);calls.push({url:req.url,key:req.headers['x-goog-api-key'],authorization:req.headers.authorization,payload});
    res.setHeader('Content-Type','application/json');
    if(mode==='quota'){res.writeHead(429);res.end(JSON.stringify({error:{message:'DO NOT EXPOSE test-only-gemini-key'}}));return;}
    if(mode==='blocked'){res.end(JSON.stringify({promptFeedback:{blockReason:'SAFETY'}}));return;}
    if(mode==='truncated'){res.end(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]}));return;}
    if(mode==='invalid'){res.end('invalid json');return;}
    const questions=JSON.parse(payload.contents.at(-1).parts[0].text);
    res.end(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'INTERNAL THOUGHT'},{text:JSON.stringify({suggestions:questions.map(q=>({id:q.id,answerIndex:2,reason:'Verified mock explanation.',needsReview:false}))})}]}}]}));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  process.env.GEMINI_API_URL=`http://127.0.0.1:${provider.address().port}/v1beta/models/test-model:generateContent`;
  const app=require('./auth-client').loadAuthenticatedApp();const db=require('../server/database');
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const fetch = await require('./auth-client').authenticatedFetch(base);
  t.after(async()=>{
    await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>provider.close(resolve))]);db.close();
    const target=path.resolve(directory);if(path.dirname(target)===path.resolve(os.tmpdir())&&path.basename(target).startsWith('pro-quiz-gemini-'))fs.rmSync(target,{recursive:true,force:true});
  });
  const request=async(route,body)=>{const r=await fetch(base+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json()};};
  let status=(await request('/api/ai/status')).data;
  assert.equal(status.provider,'Gemini');assert.equal(status.connectionVerified,false);assert.equal(status.teacherEnabled,false);assert.equal(status.key,undefined);
  const draft=(await request('/api/imports/preview',{text:'Câu 1: Thủ đô Việt Nam?\nA. Huế\nB. Đà Nẵng\nC. Hà Nội\nD. Hải Phòng'})).data.questions[0];
  const result=await request('/api/imports/ai-preview',{questions:[draft]});
  assert.equal(result.status,200);assert.equal(result.data.questions[0].aiSuggestionIndex,2);
  assert.equal(result.data.questions[0].answerIndex,null);assert.equal(result.data.questions[0].prompt,draft.prompt);
  assert.deepEqual(result.data.questions[0].options,draft.options);
  const call=calls[0];assert.equal(call.key,'test-only-gemini-key');assert.equal(call.authorization,undefined);
  assert.ok(call.payload.systemInstruction.parts[0].text.includes('gia sư'));
  assert.equal(call.payload.generationConfig.responseMimeType,'application/json');
  assert.equal(call.payload.generationConfig.maxOutputTokens,4000);assert.equal(call.payload.messages,undefined);
  status=(await request('/api/ai/status')).data;assert.equal(status.connectionVerified,true);
  const before=calls.length;assert.equal((await request('/api/attempts/1/questions/1/chat',{message:'blocked'})).status,403);assert.equal(calls.length,before);
  for(const failure of ['quota','blocked','truncated','invalid']){
    mode=failure;const response=await request('/api/imports/ai-preview',{questions:[draft]});assert.equal(response.status,502,failure);
    assert.ok(!JSON.stringify(response.data).includes('test-only-gemini-key'));assert.equal(db.prepare('SELECT COUNT(*) AS count FROM questions').get().count,0);
  }
  mode='ok';
  const config={key:process.env.GEMINI_API_KEY,url:process.env.GEMINI_API_URL};
  const text=await generateGemini(config,[{role:'system',content:'System instructions'},{role:'user',content:'Earlier question'},{role:'assistant',content:'Earlier reply'},{role:'user',content:JSON.stringify([draft])}],{maxTokens:500});
  assert.ok(!text.includes('INTERNAL THOUGHT'));assert.deepEqual(calls.at(-1).payload.contents.map(content=>content.role),['user','model','user']);
});
