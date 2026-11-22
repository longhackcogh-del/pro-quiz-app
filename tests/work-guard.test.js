const {test}=require('node:test'),assert=require('node:assert/strict');
const {workGuard}=require('../server/work-guard');
function response(){return{code:200,headers:{},set(key,value){this.headers[key]=value;return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
test('Work guards share account budgets across routes and recover after cooldown',async()=>{
 let time=0;const guard=workGuard({requests:2,concurrency:2},()=>time);let calls=0;
 const a=guard(async()=>calls++),b=guard(async()=>calls++),user={user:{id:'a'}};
 await a(user,response());await b(user,response());const limited=response();await a(user,limited);
 assert.equal(limited.code,429);assert.equal(limited.headers['Retry-After'],'60');assert.equal(calls,2);
 await b({user:{id:'b'}},response());assert.equal(calls,3);
 time=60001;await a(user,response());assert.equal(calls,4);
});
test('Active work remains counted after disconnect; failed work releases its slot',async()=>{
 const guard=workGuard({concurrency:1});let release;
 const active=guard(async()=>new Promise(resolve=>release=resolve));
 const firstResponse=response(),task=active({user:{id:'a'}},firstResponse);firstResponse.destroyed=true;
 const own=response();await active({user:{id:'a'}},own);assert.equal(own.code,429);
 const other=response();await active({user:{id:'b'}},other);assert.equal(other.code,503);
 release();await task;
 const failing=guard(async()=>{throw Error('Failed parsing');});await assert.rejects(failing({user:{id:'a'}},response()));
 let completed=false;await guard(async()=>completed=true)({user:{id:'b'}},response());assert.equal(completed,true);
});
