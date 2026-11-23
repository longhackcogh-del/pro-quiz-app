// Apply before styles load so a saved light theme never flashes dark.
(() => {
  const key='pro-quiz-theme',valid=value=>value==='pastel'||value==='focus';
  let saved,canStore=true;try{saved=localStorage.getItem(key);}catch{canStore=false;}
  document.documentElement.dataset.theme=valid(saved)?saved:'focus';
  document.documentElement.style.colorScheme=document.documentElement.dataset.theme==='pastel'?'light':'dark';
  let timer;
  function sync(){
    const theme=document.documentElement.dataset.theme,pastel=theme==='pastel';
    const toggle=document.getElementById('theme-switch');
    if(toggle){toggle.setAttribute('aria-pressed',String(pastel));toggle.setAttribute('aria-label',`Giao diện ${pastel?'Pastel':'Focus'}. Chuyển sang ${pastel?'Focus':'Pastel'}`);toggle.title=toggle.getAttribute('aria-label');}
    document.querySelectorAll('[data-theme-pick]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themePick===theme)));
    const status=document.getElementById('theme-status');if(status)status.textContent=`Đang dùng ${pastel?'Pastel · Ấm áp và dễ thương':'Focus · Dịu mắt và tập trung'}. ${canStore?'Lựa chọn được lưu trên trình duyệt này.':'Trình duyệt đang chặn lưu tùy chọn; giao diện chỉ áp dụng trong phiên hiện tại.'}`;
  }
  window.setStudyTheme=(theme,{persist=true}={})=>{
    if(!valid(theme))return;
    const root=document.documentElement;
    if(root.dataset.theme!==theme){
      clearTimeout(timer);
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches){root.classList.add('theme-changing');timer=setTimeout(()=>root.classList.remove('theme-changing'),320);}
      root.dataset.theme=theme;root.style.colorScheme=theme==='pastel'?'light':'dark';
    }
    if(persist)try{localStorage.setItem(key,theme);canStore=true;}catch{canStore=false;}
    sync();
  };
  window.toggleStudyTheme=()=>setStudyTheme(document.documentElement.dataset.theme==='pastel'?'focus':'pastel');
  addEventListener('storage',event=>{if(event.key===key)setStudyTheme(valid(event.newValue)?event.newValue:'focus',{persist:false});});
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('theme-switch')?.addEventListener('click',toggleStudyTheme);
    document.querySelectorAll('[data-theme-pick]').forEach(button=>button.addEventListener('click',()=>setStudyTheme(button.dataset.themePick)));
    sync();
  });
})();
