const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/themes.js'),'utf8');
function boot({saved=null,blocked=false,reduced=false}={}){
 const listeners={},classes=new Set(),attributes=new Map(),picks=['pastel','focus'].map(theme=>({dataset:{themePick:theme},setAttribute(name,value){this[name]=value;},addEventListener(name,callback){this[name]=callback;}}));
 const root={dataset:{},style:{},classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}},toggle={setAttribute:(name,value)=>attributes.set(name,value),getAttribute:name=>attributes.get(name),addEventListener:(name,callback)=>listeners['button:'+name]=callback},status={};
 const storage=new Map(saved===null?[]:[['pro-quiz-theme',saved]]),context={document:{documentElement:root,getElementById:id=>id==='theme-switch'?toggle:status,querySelectorAll:()=>picks,addEventListener:(name,callback)=>listeners[name]=callback},localStorage:{getItem:key=>{if(blocked)throw Error('Storage denied');return storage.get(key)||null;},setItem:(key,value)=>{if(blocked)throw Error('Storage denied');storage.set(key,value);}},matchMedia:()=>({matches:reduced}),addEventListener:(name,callback)=>listeners[name]=callback,setTimeout:callback=>(listeners.timeout=callback,1),clearTimeout(){}};
 context.window=context;vm.runInNewContext(source,context);listeners.DOMContentLoaded();return{context,root,classes,attributes,picks,listeners,storage};
}
test('Theme is applied before rendering, persists, syncs tabs and ignores invalid values',()=>{
 const app=boot({saved:'pastel'});assert.equal(app.root.dataset.theme,'pastel');assert.equal(app.root.style.colorScheme,'light');assert.equal(app.attributes.get('aria-pressed'),'true');
 app.listeners['button:click']();assert.equal(app.root.dataset.theme,'focus');assert.equal(app.storage.get('pro-quiz-theme'),'focus');assert.equal(app.picks[1]['aria-pressed'],'true');
 assert.equal(app.classes.has('theme-changing'),true);app.listeners.timeout();assert.equal(app.classes.has('theme-changing'),false);
 app.context.setStudyTheme('invalid');assert.equal(app.root.dataset.theme,'focus');
 app.listeners.storage({key:'pro-quiz-theme',newValue:'pastel'});assert.equal(app.root.dataset.theme,'pastel');assert.equal(app.storage.get('pro-quiz-theme'),'focus');
 app.listeners.storage({key:'pro-quiz-theme',newValue:null});assert.equal(app.root.dataset.theme,'focus');
 assert.equal(boot({saved:'invalid'}).root.dataset.theme,'focus');
});
test('Blocked storage and reduced motion do not prevent choosing a theme',()=>{
 const app=boot({blocked:true,reduced:true});app.context.setStudyTheme('pastel');assert.equal(app.root.dataset.theme,'pastel');assert.equal(app.classes.has('theme-changing'),false);assert.equal(app.attributes.get('aria-pressed'),'true');
 app.picks[1].click();assert.equal(app.root.dataset.theme,'focus');
});
