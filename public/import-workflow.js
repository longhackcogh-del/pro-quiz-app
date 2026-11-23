let importStep=1,importReviewFilter='all';
function showImportStep(step){
  importStep=step;
  $('#import-destination-panel').hidden=step!==1;
  document.querySelectorAll('#v-paste > .import-workflow-choices,#v-paste > .grid').forEach(node=>node.hidden=step!==2);
  $('#import-preview').hidden=step!==3||!$('#import-preview').innerHTML;
  document.querySelectorAll('[data-import-step]').forEach(button=>{button.classList.toggle('primary',Number(button.dataset.importStep)===step);if(Number(button.dataset.importStep)===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
  if(step!==3)updateImportSummary();
}
function renderImportFolders(){
  const select=$('#import-folder-target'),value=state.importFolderId==null?'none':String(state.importFolderId);
  select.innerHTML='<option value="none">Ngoài thư mục</option>'+questionFolders.map(folder=>`<option value="${folder.id}">${escapeHtml(folder.name)}</option>`).join('');
  if(value!=='none'&&!questionFolders.some(folder=>String(folder.id)===value)){const option=new Option('Thư mục không còn tồn tại — chọn lại',value);option.disabled=true;select.add(option);}
  select.value=value;updateImportSummary();
}
function changeImportMode(){
  const mode=$('#import-mode').value;
  $('#import-new-fields').hidden=mode!=='new';$('#import-existing-fields').hidden=mode!=='existing';
  updateImportSummary();
}
function importDestination(){
  const mode=$('#import-mode').value;
  if(mode==='new'){
    const name=$('#import-new-name').value.trim(),value=$('#import-folder-target').value,folderId=value==='none'?null:Number(value);
    if(!name||name.length>100)throw Error('Hãy đặt tên bộ câu hỏi từ 1 đến 100 ký tự.');
    if(value===''||folderId!==null&&!questionFolders.some(folder=>folder.id===folderId))throw Error('Hãy chọn lại thư mục lưu bộ.');
    return {newSet:{name,folderId}};
  }
  if(mode==='none')return {setId:null};
  const setId=Number($('#import-set-target').value);
  if(!questionSets.some(set=>set.id===setId))throw Error('Chọn bộ nhận câu hỏi hoặc chuyển sang Tạo bộ mới.');
  return {setId};
}
function updateImportSummary(){
  const mode=$('#import-mode').value,set=questionSets.find(set=>String(set.id)===$('#import-set-target').value);
  $('#import-destination-summary').textContent=mode==='new'?'Bộ mới chỉ được tạo khi lưu thành công. Bạn có thể nhập file hoặc dán nội dung ở bước tiếp theo.':mode==='none'?'Câu hỏi sẽ nằm ở Chưa phân loại. Bạn có thể chuyển vào bộ sau.':set?`Thêm vào “${set.name}” · Đang có ${set.questionCount} câu. Giữ nguyên các câu hiện có.`:'Chọn bộ muốn bổ sung câu hỏi.';
}
function updateImportSaveSummary(){
  const mode=$('#import-mode').value,set=questionSets.find(set=>String(set.id)===$('#import-set-target').value),count=state.pending.length;
  const label=mode==='new'?$('#import-new-name').value.trim()||'Bộ mới':mode==='none'?'Chưa phân loại':set?.name||'Chọn lại bộ đích';
  const before=mode==='existing'?set?.questionCount||0:0;
  $('#import-save-summary').textContent=mode==='none'?`Lưu ${count} câu hợp lệ vào Chưa phân loại. Câu chưa xác nhận không dùng chấm điểm.`:`Nơi lưu: ${label} · ${before} câu hiện có + ${count} câu hợp lệ = ${before+count} câu sau khi lưu (chưa trừ câu trùng nếu chọn bỏ). Câu chưa xác nhận chỉ được lưu để kiểm tra, không dùng chấm điểm.`;
}
function continueImportWorkflow(){
  if(state.importBusy)return;
  try{importDestination();showImportStep(2);}catch(error){showImportStep(1);showError(error);}
}
function showImportReview(){
  if(!state.pending.length)return toast('Hãy nhập tài liệu và nhấn Xem trước câu hỏi ở bước 2.');
  showImportStep(3);
}
async function createImportFolder(){
  const name=await appPrompt('Tạo thư mục môn học');if(!name?.trim())return;
  try{const folder=await api('/api/question-folders',post({name}));state.importFolderId=folder.id;await loadQuestionSets();}catch(error){showError(error);}
}
async function beginImportIntoSet(id){
  if(state.pending.length&&!await appConfirm('Bạn đang có bản xem trước chưa lưu. Bỏ bản nháp này để nhập thêm vào bộ đã chọn?',{title:'Đổi bộ nhận câu hỏi?',accept:'Bỏ nháp và tiếp tục'}))return;
  cancelImportPreview();$('#paste-input').value='';$('#file-upload-status-label').textContent='Chưa chọn tệp';state.importSetId=id;const set=questionSets.find(set=>set.id===id);state.importFolderId=set?.folderId??null;
  $('#import-mode').value='existing';$('#import-set-target').value=String(id);changeImportMode();setView('v-paste');showImportStep(2);
}
function beginNewImport(){
  if(state.pending.length)return navigateTo('v-paste');
  prepareImportDestination();state.importSetId=null;$('#import-mode').value='new';changeImportMode();setView('v-paste');showImportStep(1);
}
function filterImportReview(value){
  try{state.pending=collectPreview();importReviewFilter=value;renderImportPreview({questions:state.pending,invalid:state.importInvalid,aiMessage:importPreviewMessage});}catch(error){showError(error);}
}
async function practiceSelectedLibrarySets(){
  const ids=[...librarySelected];await openPracticePicker();if(!$('#practice-picker-dialog').open)return;
  practiceDraft=new Set(ids.map(String));practiceOpenFolders=new Set(questionSets.filter(set=>ids.includes(set.id)&&set.folderId!=null).map(set=>set.folderId));renderPracticeChoices();
}
