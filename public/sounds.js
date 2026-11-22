(() => {
  const profiles={
    tap:[{frequency:880,delay:0,duration:0.045,gain:0.055}],
    correct:[{frequency:659.25,delay:0,duration:0.13,gain:0.09},{frequency:880,delay:0.075,duration:0.15,gain:0.09},{frequency:1318.51,delay:0.15,duration:0.19,gain:0.08}],
    wrong:[{frequency:392,delay:0,duration:0.17,gain:0.09},{frequency:293.66,delay:0.12,duration:0.21,gain:0.08}]
  };
  let enabled=true,context;
  try{enabled=window.localStorage.getItem('pro-quiz-sound')!=='off';}catch{}
  function audioContext(){
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)return null;
      context??=new Audio();
      if(context.state==='suspended')context.resume().catch(()=>{});
      return context;
    }catch{return null;}
  }
  function play(name){
    if(!enabled||!profiles[name])return false;
    const audio=audioContext();if(!audio)return false;
    try{
      for(const note of profiles[name]){
        const oscillator=audio.createOscillator(),gain=audio.createGain(),start=audio.currentTime+note.delay;
        oscillator.type='sine';oscillator.frequency.value=note.frequency;
        gain.gain.setValueAtTime(0.0001,start);
        gain.gain.linearRampToValueAtTime(note.gain,start+0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001,start+note.duration);
        oscillator.connect(gain);gain.connect(audio.destination);
        oscillator.start(start);oscillator.stop(start+note.duration);
        oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      }
      return true;
    }catch{return false;}
  }
  function updateButton(){
    const button=document.querySelector('#sound-toggle');if(!button)return;
    button.textContent=enabled?'🔊':'🔇';button.setAttribute('aria-pressed',String(enabled));
    button.setAttribute('aria-label',enabled?'Tắt âm thanh':'Bật âm thanh');button.title=enabled?'Tắt âm thanh':'Bật âm thanh';
  }
  function toggle(){
    enabled=!enabled;try{window.localStorage.setItem('pro-quiz-sound',enabled?'on':'off');}catch{}
    updateButton();if(enabled)play('tap');
  }
  window.quizSound={play,toggle,profiles,get enabled(){return enabled;}};
  document.addEventListener('pointerdown',()=>{if(enabled)audioContext();},{passive:true});
  document.addEventListener('click',event=>{
    const control=event.target.closest?.('button,a.btn,input[type=checkbox],input[type=radio],summary');
    if(!control||control.id==='sound-toggle'||control.disabled||control.getAttribute('aria-disabled')==='true')return;
    const selection=window.getSelection();if(selection&&!selection.isCollapsed)return;
    play('tap');
  },{capture:true});
  document.addEventListener('DOMContentLoaded',updateButton);
})();
