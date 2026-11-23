let movingSetId=null;
const librarySelected=new Set();
let movingSetIds=null,libraryBusy=false;
function renderFolderLibrary(){
  const folder=questionFolders.find(item=>item.id===bankFolder);
  $('#folder-current').textContent=folder?.name||'Thư viện của tôi';
  $('#folder-back').hidden=!folder;
  $('#folder-rename').hidden=!folder;$('#folder-delete').hidden=!folder;
  const sets=questionSets.filter(item=>(item.folderId??null)===bankFolder);
  const visibleIds=new Set(sets.map(set=>set.id));
  for(const id of librarySelected)if(!visibleIds.has(id))librarySelected.delete(id);
  $('#library-selection').hidden=!librarySelected.size;
  $('#library-selected-count').textContent=`Đã chọn ${librarySelected.size} bộ`;
  $('#library-selection').querySelectorAll('button').forEach(button=>button.disabled=libraryBusy);
  const folders=folder?[]:questionFolders;
  $('#folder-library').innerHTML=folders.map(item=>{
    const children=questionSets.filter(set=>set.folderId===item.id);
    return `<button class="library-card library-folder" data-folder-id="${item.id}" onclick="openQuestionFolder(${item.id})"><span class="library-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg></span><strong>${escapeHtml(item.name)}</strong><small>${children.length} bộ câu hỏi · ${children.reduce((total,set)=>total+set.questionCount,0)} câu</small><span class="library-open">Mở thư mục →</span></button>`;
  }).join('')+sets.map(set=>`<article class="library-card library-set ${$('#question-set-filter').value===String(set.id)?'selected':''}" data-set-id="${set.id}"><input class="library-set-check" type="checkbox" aria-label="Chọn bộ ${escapeHtml(set.name)}" ${librarySelected.has(set.id)?'checked':''} ${libraryBusy?'disabled':''} onchange="toggleLibrarySet(${set.id},this.checked)"><span class="library-icon" aria-hidden="true">▤</span><strong>${escapeHtml(set.name)}</strong><small>${set.questionCount} câu hỏi</small><div class="library-card-actions"><button class="btn primary" onclick="openLibrarySet(${set.id})">Xem</button><button class="btn" onclick="practiceLibrarySet(${set.id})" aria-label="Luyện tập ${escapeHtml(set.name)}">▷ Học</button><button class="btn" onclick="openSetFolderDialog(${set.id})">Chuyển</button></div></article>`).join('');
  if(!folders.length&&!sets.length)$('#folder-library').innerHTML=`<p class="library-empty muted">${folder?'Thư mục chưa có bộ câu hỏi. Tạo bộ mới tại đây hoặc chuyển bộ có sẵn vào.':'Tạo thư mục theo môn học, rồi thêm các bộ câu hỏi theo chương hoặc chủ đề.'}</p>`;
}
function openQuestionFolder(id){
  librarySelected.clear();
  bankFolder=id;$('#question-set-filter').value='all';bankSelected.clear();bankPage=1;
  renderFolderLibrary();renderBank();
}
function openLibrarySet(id){
  $('#question-set-filter').value=String(id);bankFilterChanged();
  $('#scroller-questions-list').scrollIntoView({behavior:'smooth',block:'start'});
}
function practiceLibrarySet(id){$('#question-set-filter').value=String(id);return practiceQuestionSet();}
async function createQuestionFolder(){
  const name=await appPrompt('Tạo thư mục mới');if(!name?.trim())return;
  try{const folder=await api('/api/question-folders',post({name}));await loadQuestionSets();openQuestionFolder(folder.id);}
  catch(error){showError(error);}
}
async function renameQuestionFolder(){
  const folder=questionFolders.find(item=>item.id===bankFolder);if(!folder)return;
  const name=await appPrompt('Đổi tên thư mục',folder.name);if(!name?.trim())return;
  try{await api('/api/question-folders/'+folder.id,{...post({name}),method:'PATCH'});await loadQuestionSets();}
  catch(error){showError(error);}
}
async function deleteQuestionFolder(){
  const folder=questionFolders.find(item=>item.id===bankFolder);if(!folder || !await appConfirm(`Thư mục “${folder.name}” sẽ được gỡ. Các bộ và câu hỏi bên trong được giữ lại ở Thư viện của tôi.`,{title:'Xóa thư mục?',accept:'Xóa thư mục',danger:true}))return;
  try{await api('/api/question-folders/'+folder.id,{method:'DELETE'});bankFolder=null;await loadQuestionSets();openQuestionFolder(null);}
  catch(error){showError(error);}
}
function openSetFolderDialog(id){
  movingSetIds=null;
  const set=questionSets.find(item=>item.id===id);if(!set)return;
  movingSetId=id;$('#move-set-name').textContent=set.name;
  $('#set-folder-target').innerHTML='<option value="none">Ngoài thư mục</option>'+questionFolders.map(folder=>`<option value="${folder.id}">${escapeHtml(folder.name)}</option>`).join('');
  $('#set-folder-target').value=set.folderId==null?'none':String(set.folderId);
  $('#move-set-dialog').showModal();
}
async function moveSetToFolder(event){
  event.preventDefault();if(libraryBusy||$('#move-set-save').disabled||movingSetId===null&&!movingSetIds?.length)return;
  if(movingSetIds?.length){
    const ids=[...movingSetIds],value=$('#set-folder-target').value,folderId=value==='none'?null:Number(value);
    libraryBusy=true;$('#move-set-save').disabled=true;
    try{await api('/api/question-sets/bulk',post({setIds:ids,action:'move',folderId}));movingSetIds=null;$('#move-set-dialog').close();librarySelected.clear();bankFolder=folderId;$('#question-set-filter').value='all';await openViewQuestions();toast(`Đã chuyển ${ids.length} bộ câu hỏi.`);}
    catch(error){showError(error);}finally{libraryBusy=false;$('#move-set-save').disabled=false;renderFolderLibrary();}return;
  }
  const id=movingSetId,value=$('#set-folder-target').value,folderId=value==='none'?null:Number(value);
  $('#move-set-save').disabled=true;
  try{await api('/api/question-sets/'+id+'/folder',{...post({folderId}),method:'PATCH'});$('#move-set-dialog').close();bankFolder=folderId;await loadQuestionSets();$('#question-set-filter').value=String(id);bankFilterChanged();toast('Đã chuyển bộ câu hỏi.');}
  catch(error){showError(error);}finally{$('#move-set-save').disabled=false;}
}
function toggleLibrarySet(id,checked){if(libraryBusy)return;if(checked)librarySelected.add(id);else librarySelected.delete(id);renderFolderLibrary();}
function clearLibrarySelection(){if(libraryBusy)return;librarySelected.clear();renderFolderLibrary();}
function openSelectedSetsDialog(){
  if(libraryBusy||!librarySelected.size)return;
  openSetFolderDialog([...librarySelected][0]);movingSetIds=[...librarySelected];movingSetId=null;
  $('#move-set-name').textContent=`${movingSetIds.length} bộ đã chọn. Giữ nguyên câu hỏi bên trong các bộ.`;
}
async function deleteSelectedSets(){
  if(libraryBusy||!librarySelected.size)return;
  const ids=[...librarySelected];
  if(!await appConfirm(`Xóa ${ids.length} bộ đã chọn? Các câu hỏi được giữ ở mục Chưa phân loại.`,{title:'Xóa bộ câu hỏi?',accept:'Xóa bộ',danger:true}))return;
  libraryBusy=true;renderFolderLibrary();
  try{await api('/api/question-sets/bulk',post({setIds:ids,action:'delete'}));librarySelected.clear();await openViewQuestions();toast(`Đã xóa ${ids.length} bộ. Câu hỏi được giữ lại.`);}
  catch(error){showError(error);}finally{libraryBusy=false;renderFolderLibrary();}
}
