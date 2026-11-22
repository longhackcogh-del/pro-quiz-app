const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/sounds.js'),'utf8');
function setup(stored=null,available=true){
 const calls={contexts:0,notes:[],stored,attributes:{}},events={};
 const button={setAttribute:(key,value)=>calls.attributes[key]=value};
 const param={setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}};
 class Audio{
  constructor(){calls.contexts++;this.currentTime=0;this.state='running';this.destination={};}
  createOscillator(){const note={frequency:{},connect(){},start(){calls.notes.push(note.frequency.value);},stop(){},disconnect(){}};return note;}
  createGain(){return{gain:param,connect(){},disconnect(){}};}
 }
 const sandbox={window:{...(available?{AudioContext:Audio}:{}),localStorage:{getItem:()=>stored,setItem:(_,value)=>calls.stored=value},getSelection:()=>({isCollapsed:true})},document:{querySelector:()=>button,addEventListener:(name,fn)=>events[name]=fn}};
 vm.runInNewContext(source,sandbox);return{sound:sandbox.window.quizSound,calls,events,sandbox};
}
test('Sounds start only on interaction, mute persists and unsupported browsers keep working',()=>{
 const {sound,calls,events}=setup();assert.equal(calls.contexts,0);events.DOMContentLoaded();assert.equal(calls.attributes['aria-pressed'],'true');
 sound.play('tap');assert.equal(calls.notes.length,1);sound.play('correct');assert.equal(calls.notes.length,4);sound.play('wrong');assert.equal(calls.notes.length,6);assert.equal(calls.contexts,1);
 sound.toggle();assert.equal(sound.enabled,false);assert.equal(calls.stored,'off');sound.play('correct');assert.equal(calls.notes.length,6);
 sound.toggle();assert.equal(calls.stored,'on');assert.equal(calls.notes.length,7);
 const muted=setup('off');muted.events.pointerdown();muted.sound.play('wrong');assert.equal(muted.calls.contexts,0);
 assert.equal(setup(null,false).sound.play('correct'),false);
});
test('Disabled controls and selecting answer text produce no tap',()=>{
 const {events,calls,sandbox}=setup();const control={id:'answer',disabled:true,getAttribute:()=>null};const event={target:{closest:()=>control}};
 events.click(event);assert.equal(calls.notes.length,0);control.disabled=false;
 sandbox.window.getSelection=()=>({isCollapsed:false});events.click(event);assert.equal(calls.notes.length,0);
 sandbox.window.getSelection=()=>({isCollapsed:true});events.click(event);assert.equal(calls.notes.length,1);
});
