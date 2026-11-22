function appDialog({title,message='',value,accept='Xác nhận',danger=false}){
  const dialog=$('#app-dialog');if(dialog.open)return Promise.resolve(null);
  const epoch=accountEpoch,input=$('#app-dialog-input');
  $('#app-dialog-title').textContent=title;$('#app-dialog-message').textContent=message;
  $('#app-dialog-message').hidden=!message;
  $('#app-dialog-field').hidden=value===undefined;input.required=value!==undefined;input.value=value??'';
  $('#app-dialog-accept').textContent=accept;$('#app-dialog-accept').className=danger?'btn danger':'btn primary';
  dialog.returnValue='';
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>{
      const result=dialog.returnValue==='accept'&&epoch===accountEpoch?(value===undefined?true:input.value.trim()):null;
      input.value='';resolve(result);
    },{once:true});
    dialog.showModal();
    (value!==undefined?input:danger?$('#app-dialog-cancel'):$('#app-dialog-accept')).focus();
    if(value!==undefined)input.select();
  });
}
async function appConfirm(message,{title='Xác nhận thao tác',accept='Xác nhận',danger=false}={}){
  return await appDialog({title,message,accept,danger})===true;
}
function appPrompt(title,value=''){return appDialog({title,value,accept:'Lưu'});}
function resetAppDialog(){
  const dialog=$('#app-dialog');if(dialog.open)dialog.close('cancel');
  $('#app-dialog-input').value='';$('#app-dialog-message').textContent='';
}
