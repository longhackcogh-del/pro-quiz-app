const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
test('Parser timeout or crash rejects safely and waits for process cleanup without forwarding secrets',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server/document-reader.js'),'utf8');
 for(const mode of ['timeout','crash']){
  const child=new EventEmitter();child.pid=123;let timeout,options,killed=false;
  child.send=()=>{};child.kill=()=>{killed=true;queueMicrotask(()=>child.emit('exit',null,'SIGKILL'));};
  const sandbox={module:{exports:{}},__dirname:path.join(__dirname,'../server'),process:{platform:'linux',env:{GEMINI_API_KEY:'must-not-forward'}},setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>{},require:name=>name==='node:path'?path:{fork:(_file,_args,value)=>{options=value;return child;}}};
  vm.runInNewContext(source,sandbox);const promise=sandbox.module.exports.extractDocument(Buffer.from('test'),'.pdf');
  assert.deepEqual(Object.keys(options.env),[]);assert.ok(options.execArgv.includes('--max-old-space-size=128'));
  if(mode==='timeout')timeout();else child.emit('exit',1,'SIGSEGV');
  await assert.rejects(promise,/Không thể đọc tài liệu/);assert.equal(killed,mode==='timeout');
 }
});
