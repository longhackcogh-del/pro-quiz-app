let practiceSelection=new Set(),practiceDraft=new Set(),practiceOpenFolders=new Set(),practicePickerOpening=null;
function selectionFromAttempt(attempt){return new Set((attempt?.questions||[]).map(question=>question.setId==null?'none':String(question.setId)));}
function practiceSetLabel(id){return id==='none'?'Chưa phân loại':questionSets.find(set=>String(set.id)===id)?.name||'';}
function updatePracticeSelectionLabel(){
  const button=$('#practice-picker-button');
  button.textContent=practiceSelection.size===1?practiceSetLabel([...practiceSelection][0]):practiceSelection.size?`${practiceSelection.size} bộ câu hỏi`:'Chọn bộ câu hỏi';
  button.title=[...practiceSelection].map(practiceSetLabel).join(', ');
}
function refreshPracticeChoices(){
  for(const selection of [practiceSelection,practiceDraft])for(const id of selection)if(id!=='none'&&!questionSets.some(set=>String(set.id)===id))selection.delete(id);
  updatePracticeSelectionLabel();if($('#practice-picker-dialog').open)renderPracticeChoices();
}
function updatePracticeDraft(){
  $('#practice-selection-count').textContent=`Đã chọn ${practiceDraft.size} bộ`;
  $('#practice-selection-start').disabled=!practiceDraft.size||Boolean(state.practiceLoading);
  $('#practice-selection-clear').disabled=!practiceDraft.size||Boolean(state.practiceLoading);
  $('#practice-selection-close').disabled=Boolean(state.practiceLoading);
  $('#practice-set-search').disabled=Boolean(state.practiceLoading);
  document.querySelectorAll('#practice-set-tree input').forEach(input=>input.disabled=Boolean(state.practiceLoading));
  for(const badge of document.querySelectorAll('[data-practice-folder-count]')){
    const sets=questionSets.filter(set=>set.folderId===Number(badge.dataset.practiceFolderCount));
    badge.textContent=`${sets.filter(set=>practiceDraft.has(String(set.id))).length}/${sets.length}`;
  }
}
function togglePracticeSet(id,checked){checked?practiceDraft.add(id):practiceDraft.delete(id);updatePracticeDraft();}
function clearPracticeSelection(){practiceDraft.clear();document.querySelectorAll('#practice-set-tree input').forEach(input=>input.checked=false);updatePracticeDraft();}
function renderPracticeChoices(){
  const normalize=value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('vi');
  const term=normalize($('#practice-set-search').value.trim());
  const option=set=>{const id=String(set.id);return `<label class="practice-set-choice"><input type="checkbox" value="${id}" ${practiceDraft.has(id)?'checked':''} onchange="togglePracticeSet(this.value,this.checked)"><span>${escapeHtml(set.name)}</span><small>${set.questionCount} câu</small></label>`;};
  let html='';
  for(const folder of questionFolders){
    const sets=questionSets.filter(set=>set.folderId===folder.id&&(normalize(folder.name).includes(term)||normalize(set.name).includes(term)));
    if(term&&!sets.length&&!normalize(folder.name).includes(term))continue;
    html+=`<details class="practice-folder" data-picker-folder="${folder.id}" ${term||practiceOpenFolders.has(folder.id)?'open':''}><summary><span aria-hidden="true">📁</span><strong>${escapeHtml(folder.name)}</strong><small data-practice-folder-count="${folder.id}"></small></summary><div class="practice-folder-sets">${sets.map(option).join('')||'<p class="muted small">Thư mục chưa có bộ câu hỏi.</p>'}</div></details>`;
  }
  const loose=questionSets.filter(set=>set.folderId==null&&normalize(set.name).includes(term));
  if(loose.length)html+=`<div class="practice-loose-sets"><p class="small muted">Ngoài thư mục</p>${loose.map(option).join('')}</div>`;
  if(normalize('Chưa phân loại').includes(term))html+=`<label class="practice-set-choice"><input type="checkbox" value="none" ${practiceDraft.has('none')?'checked':''} onchange="togglePracticeSet(this.value,this.checked)"><span>Chưa phân loại<small>Các câu hỏi chưa được xếp vào bộ</small></span></label>`;
  $('#practice-set-tree').innerHTML=html||'<p class="empty">Không tìm thấy bộ câu hỏi phù hợp.</p>';
  $('#practice-set-tree').querySelectorAll('details').forEach(details=>details.addEventListener('toggle',()=>{if(term)return;const id=Number(details.dataset.pickerFolder);details.open?practiceOpenFolders.add(id):practiceOpenFolders.delete(id);}));
  updatePracticeDraft();
}
async function openPracticePicker(){
  if(state.answerPending||state.submitting||state.navigationPending)return toast('Hãy đợi thao tác hiện tại được lưu xong.');
  if(practicePickerOpening||$('#practice-picker-dialog').open)return;
  const opening={epoch:accountEpoch};practicePickerOpening=opening;
  try{
    await loadQuestionSets();if(practicePickerOpening!==opening||accountEpoch!==opening.epoch)return;
    window.clearTimeout(state.transitionTimer);
    if(state.view==='v-quiz'){state.busy=false;renderActiveQuestion();}
    practiceDraft=new Set(practiceSelection);practiceOpenFolders=new Set(questionSets.filter(set=>practiceDraft.has(String(set.id))&&set.folderId!=null).map(set=>set.folderId));
    $('#practice-set-search').value='';$('#practice-picker-status').textContent='';renderPracticeChoices();$('#practice-picker-dialog').showModal();
  }catch(error){showError(error);}finally{if(practicePickerOpening===opening)practicePickerOpening=null;}
}
async function startSelectedPractice(){
  if(state.practiceLoading||!practiceDraft.size)return;
  const load={},epoch=accountEpoch,selection=new Set(practiceDraft);state.practiceLoading=load;updatePracticeDraft();
  $('#practice-picker-status').textContent='Đang chuẩn bị câu hỏi…';
  try{
    const questions=await api('/api/questions');
    const questionIds=questions.filter(question=>selection.has(question.setId==null?'none':String(question.setId))&&question.answerStatus==='confirmed').map(question=>question.id);
    if(!questionIds.length){$('#practice-picker-status').textContent='Các bộ đã chọn chưa có câu hỏi được xác nhận đáp án.';return;}
    const attempt=await api('/api/attempts',post({questionIds}));
    if(epoch!==accountEpoch||state.practiceLoading!==load)return;
    state.attempt=attempt;$('#practice-picker-dialog').close();await showQuiz();
  }catch(error){if(epoch===accountEpoch)$('#practice-picker-status').textContent=error.message;}
  finally{if(state.practiceLoading===load){state.practiceLoading=null;updatePracticeDraft();}}
}
function askPracticeDecision({title,detail,accept,alternative}){
  const dialog=$('#practice-decision');if(dialog.open)return Promise.resolve(null);
  $('#practice-decision-title').textContent=title;$('#practice-decision-detail').textContent=detail;
  $('#practice-decision-accept').textContent=accept;$('#practice-decision-alternative').textContent=alternative;
  dialog.returnValue='';return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(['accept','alternative'].includes(dialog.returnValue)?dialog.returnValue:null),{once:true});dialog.showModal();});
}
function resetPracticePicker(){
  practicePickerOpening=null;practiceSelection.clear();practiceDraft.clear();practiceOpenFolders.clear();
  for(const id of ['practice-picker-dialog','practice-decision'])if($('#'+id).open)$('#'+id).close();
  $('#practice-set-tree').replaceChildren();$('#practice-set-search').value='';$('#practice-picker-status').textContent='';
  $('#practice-decision-detail').textContent='';updatePracticeSelectionLabel();
}
