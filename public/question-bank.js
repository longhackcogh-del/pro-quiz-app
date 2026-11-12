let questionSets = [];
let bankPage = 1;
const bankSelected = new Set();
const bankAnswerDrafts = new Map();
let editingQuestionId = null;
let editTrigger;
let bankMutationBusy = false;
const bankSearchText = new WeakMap();

function filteredBankQuestions() {
  const term = $('#bank-search').value.trim().toLocaleLowerCase('vi');
  const status = $('#bank-filter').value;
  const ascending = ['oldest','idAsc'].includes($('#bankSort').value);
  const set = $('#question-set-filter').value;
  return state.questions.filter(question => {
    if (!(set === 'all' || (set === 'none' ? question.setId == null : question.setId === Number(set))) || !(status === 'all' || question.answerStatus === status)) return false;
    if (!term) return true;
    if (!bankSearchText.has(question)) bankSearchText.set(question,[question.id,question.prompt,...question.options].join(' ').toLocaleLowerCase('vi'));
    return bankSearchText.get(question).includes(term);
  }).sort((a,b) => ascending ? a.id-b.id : b.id-a.id);
}
function bankPageData() {
  const list = filteredBankQuestions();
  const size = Number($('#pageSize').value);
  const pages = Math.max(1,Math.ceil(list.length/size));
  bankPage = Math.min(Math.max(1,Math.trunc(bankPage)),pages);
  const start = (bankPage-1)*size;
  return {list,pages,start,visible:list.slice(start,start+size)};
}
function renderBank() {
  const ids = new Set(state.questions.map(question => question.id));
  for (const id of bankSelected) if (!ids.has(id)) bankSelected.delete(id);
  for (const id of bankAnswerDrafts.keys()) if (!ids.has(id)) bankAnswerDrafts.delete(id);
  const {list,pages,start,visible} = bankPageData();
  const confirmed = state.questions.filter(question => question.answerStatus === 'confirmed').length;
  $('#bankTotal').textContent = state.questions.length.toLocaleString('vi');
  $('#bankConfirmed').textContent = confirmed.toLocaleString('vi');
  $('#bankPending').textContent = (state.questions.length-confirmed).toLocaleString('vi');
  $('#bankAccuracy').textContent = state.questions.length ? Math.round(confirmed*100/state.questions.length)+'%' : '—';
  $('#bankRange').textContent = list.length ? `Hiển thị ${start+1} – ${start+visible.length} trên ${list.length.toLocaleString('vi')} câu` : 'Hiển thị 0 câu';
  $('#pageCount').textContent = '/ '+pages;
  $('#jumpPage').max = pages;
  $('#jumpPage').value = bankPage;
  $('#bank-empty').hidden = visible.length > 0;
  $('#bankTableBody').innerHTML = visible.map(question => {
    const confirmed = question.answerStatus === 'confirmed';
    const draft = bankAnswerDrafts.has(question.id) ? bankAnswerDrafts.get(question.id) : question.aiSuggestionIndex;
    const review = !confirmed ? `${suggestionMarkup(question)}<div class="review-actions"><button class="btn" onclick="suggestStoredQuestion(${question.id},this)">AI đề xuất</button><label>Đáp án<select class="field" id="confirm-question-${question.id}" onchange="bankAnswerDrafts.set(${question.id},this.value === '' ? null : Number(this.value))"><option value="">Chọn đáp án</option>${question.options.map((_,index) => `<option value="${index}" ${draft === index ? 'selected' : ''}>${letter(index)}</option>`).join('')}</select></label><button class="btn primary" onclick="confirmStoredQuestion(${question.id},this)">Tôi xác nhận đáp án</button></div>` : '';
    return `<tr class="data-row"><td><input type="checkbox" aria-label="Chọn câu ${question.id}" ${bankSelected.has(question.id) ? 'checked' : ''} onchange="toggleQuestionSelection(${question.id},this.checked)"></td><td class="qid">#${question.id}</td><td class="question-cell">${escapeHtml(question.prompt)}<details><summary>Xem lựa chọn${confirmed ? '' : ' và xác nhận'}</summary><div class="bank-detail-options">${question.options.map((option,index) => `<p>${letter(index)}. ${escapeHtml(option)}</p>`).join('')}</div>${review}</details></td><td>${confirmed ? `<span class="answer-chip">${letter(question.answerIndex)}. ${escapeHtml(question.options[question.answerIndex])}</span>` : '<span class="muted">Chưa có</span>'}</td><td><span class="status-chip ${confirmed ? 'confirmed' : 'pending'}">${confirmed ? '✓ Đã xác nhận' : '◷ Chờ xác nhận'}</span></td><td><div class="table-actions"><button class="btn" onclick="editQuestion(${question.id})">✎ Sửa</button><button class="btn danger" onclick="deleteQuestion(${question.id})">Xóa</button></div></td></tr>`;
  }).join('');
  const checked = visible.filter(question => bankSelected.has(question.id)).length;
  $('#selectPage').checked = visible.length > 0 && checked === visible.length;
  $('#selectPage').indeterminate = checked > 0 && checked < visible.length;
  $('#selectedCount').textContent = `Đã chọn ${bankSelected.size} câu`;
  renderPageButtons(pages);
  document.querySelectorAll('#v-list .bulk-actions button').forEach(button => { button.disabled = bankMutationBusy || !bankSelected.size; });
}
function renderPageButtons(pages) {
  const numbers = [...new Set([1,bankPage-1,bankPage,bankPage+1,pages])].filter(number => number >= 1 && number <= pages).sort((a,b)=>a-b);
  let previous = 0;
  const buttons = numbers.map(number => {
    const gap = previous && number-previous > 1 ? '<span class="muted">…</span>' : '';
    previous = number;
    return `${gap}<button class="${number === bankPage ? 'active' : ''}" ${number === bankPage ? 'aria-current="page"' : ''} onclick="setBankPage(${number})">${number}</button>`;
  }).join('');
  $('#pageButtons').innerHTML = `<button aria-label="Trang đầu" ${bankPage===1 ? 'disabled' : ''} onclick="setBankPage(1)">«</button><button aria-label="Trang trước" ${bankPage===1 ? 'disabled' : ''} onclick="setBankPage(${bankPage-1})">‹</button>${buttons}<button aria-label="Trang sau" ${bankPage===pages ? 'disabled' : ''} onclick="setBankPage(${bankPage+1})">›</button><button aria-label="Trang cuối" ${bankPage===pages ? 'disabled' : ''} onclick="setBankPage(${pages})">»</button>`;
}
function setBankPage(page) { bankPage = page; renderBank(); }
function jumpToPage() { setBankPage(Number($('#jumpPage').value) || 1); }
function changePageSize() { bankPage = 1; renderBank(); }
function bankFilterChanged() { bankPage = 1; renderBank(); }
function clearBankSearch() { $('#bank-search').value = ''; bankFilterChanged(); }
function toggleQuestionSelection(id,checked) { if (checked) bankSelected.add(id); else bankSelected.delete(id); renderBank(); }
function toggleSelectPage(checked) { bankPageData().visible.forEach(question => { if (checked) bankSelected.add(question.id); else bankSelected.delete(question.id); }); renderBank(); }

async function bulkDelete() {
  if (bankMutationBusy || !bankSelected.size || !window.confirm(`Xóa ${bankSelected.size} câu đã chọn khỏi kho thật? Lịch sử liên quan cũng có thể bị xóa.`)) return;
  bankMutationBusy = true;
  renderBank();
  let deleted = 0;
  try {
    for (const id of [...bankSelected]) { await api(`/api/questions/${id}`,{method:'DELETE'}); bankSelected.delete(id); deleted++; }
    toast(`Đã xóa ${deleted} câu hỏi.`);
  } catch (error) { showError(new Error(`Đã xóa ${deleted} câu. ${error.message}`)); }
  finally { bankMutationBusy = false; await openViewQuestions(); await refreshHeader().catch(showError); }
}
async function bulkConfirm() {
  if (bankMutationBusy || !bankSelected.size) return;
  const candidates = state.questions.filter(question => bankSelected.has(question.id) && question.answerStatus !== 'confirmed').map(question => ({id:question.id, answer:bankAnswerDrafts.has(question.id) ? bankAnswerDrafts.get(question.id) : question.aiSuggestionIndex})).filter(question => Number.isInteger(question.answer) && question.answer >= 0 && question.answer <= 3);
  if (!candidates.length) return toast('Chọn đáp án cho các câu chờ duyệt trước khi xác nhận hàng loạt.');
  if (!window.confirm(`Bạn đã kiểm tra đáp án cho ${candidates.length} câu và xác nhận dùng chúng để chấm điểm? Các câu chưa có đáp án sẽ được bỏ qua.`)) return;
  bankMutationBusy = true;
  renderBank();
  let confirmed = 0;
  try {
    for (const question of candidates) { await api(`/api/questions/${question.id}`,{...post({answerIndex:question.answer}),method:'PATCH'}); bankSelected.delete(question.id); bankAnswerDrafts.delete(question.id); confirmed++; }
    toast(`Đã xác nhận ${confirmed} câu hỏi.`);
  } catch (error) { showError(new Error(`Đã xác nhận ${confirmed} câu. ${error.message}`)); }
  finally { bankMutationBusy = false; await openViewQuestions(); await refreshHeader().catch(showError); }
}
function editQuestion(id) {
  const question = state.questions.find(question => question.id === id);
  if (!question) return;
  editingQuestionId = id;
  editTrigger = document.activeElement;
  $('#editQuestion').value = question.prompt;
  $('#editSubtitle').textContent = 'Câu hỏi #'+id;
  $('#editOptions').innerHTML = question.options.map((option,index) => `<label class="edit-option-row"><b>${letter(index)}.</b><input class="field" id="editOption${index}" value="${escapeHtml(option)}" required></label>`).join('');
  $('#editCorrect').value = question.answerIndex ?? question.aiSuggestionIndex ?? '';
  $('#editConfirmed').checked = false;
  $('#editModal').classList.add('open');
  $('#editQuestion').focus();
}
function closeEdit() { $('#editModal').classList.remove('open'); editingQuestionId = null; editTrigger?.focus(); }
async function saveEdit() {
  if (editingQuestionId === null || $('#bank-edit-save').disabled) return;
  const id = editingQuestionId;
  const prompt = $('#editQuestion').value.trim();
  const options = [0,1,2,3].map(index => $('#editOption'+index).value.trim());
  const answer = $('#editCorrect').value;
  const confirmed = $('#editConfirmed').checked;
  if (!prompt || options.some(option => !option)) return toast('Nhập nội dung và đủ bốn lựa chọn.');
  if (confirmed && answer === '') return toast('Chọn đáp án trước khi xác nhận.');
  $('#bank-edit-save').disabled = true;
  try {
    await api(`/api/questions/${id}${confirmed ? '' : '/content'}`,{...post({prompt,options,...(confirmed ? {answerIndex:Number(answer)} : {})}),method:'PATCH'});
    bankAnswerDrafts.delete(id);
    closeEdit();
    await openViewQuestions();
    await refreshHeader();
    toast(confirmed ? 'Đã lưu và xác nhận đáp án.' : 'Đã lưu nội dung. Câu hỏi đang chờ xác nhận đáp án.');
  } catch (error) { showError(error); }
  finally { $('#bank-edit-save').disabled = false; }
}
async function deleteQuestion(id) {
  if (!window.confirm(`Xóa câu hỏi #${id} khỏi kho?`)) return;
  try { await api(`/api/questions/${id}`,{method:'DELETE'}); bankSelected.delete(id); await openViewQuestions(); await refreshHeader(); toast('Đã xóa câu hỏi.'); }
  catch (error) { showError(error); }
}
document.addEventListener('DOMContentLoaded', () => {
  $('#editModal').addEventListener('input',event => { if (event.target.id !== 'editConfirmed') $('#editConfirmed').checked = false; });
  $('#editCorrect').addEventListener('change',() => { $('#editConfirmed').checked = false; });
  $('#editModal').addEventListener('keydown',event => {
    if (event.key === 'Escape') { event.stopPropagation(); closeEdit(); }
    if (event.key === 'Tab') {
      const items = [...$('#editModal').querySelectorAll('button:not(:disabled),input,textarea,select')];
      const first=items[0],last=items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
});

async function loadQuestionSets() {
  questionSets = await api('/api/question-sets');
  renderQuestionSets();
}
function renderQuestionSets() {
  for (const id of ['question-set-filter','question-set-target']) {
    const select=$('#'+id), value=select.value;
    select.innerHTML=(id==='question-set-filter' ? '<option value="all">Tất cả bộ câu hỏi</option>' : '')+'<option value="none">Chưa phân loại</option>'+questionSets.map(set=>`<option value="${set.id}">${escapeHtml(set.name)} (${set.questionCount})</option>`).join('');
    if ([...select.options].some(option=>option.value===value)) select.value=value;
  }
}
async function createQuestionSet() {
  const name=window.prompt('Tên bộ câu hỏi mới:');
  if (!name?.trim()) return;
  try { const set=await api('/api/question-sets',post({name})); await loadQuestionSets(); $('#question-set-filter').value=String(set.id); bankFilterChanged(); }
  catch(error) { showError(error); }
}
function selectedQuestionSet() { return questionSets.find(set=>String(set.id)===$('#question-set-filter').value); }
async function renameQuestionSet() {
  const set=selectedQuestionSet(); if (!set) return toast('Chọn một bộ câu hỏi để đổi tên.');
  const name=window.prompt('Tên mới:',set.name); if (!name?.trim()) return;
  try { await api('/api/question-sets/'+set.id,{...post({name}),method:'PATCH'}); await loadQuestionSets(); }
  catch(error) { showError(error); }
}
async function deleteQuestionSet() {
  const set=selectedQuestionSet(); if (!set) return toast('Chọn một bộ câu hỏi để xóa.');
  if (!window.confirm(`Xóa bộ “${set.name}”? Câu hỏi được giữ ở mục Chưa phân loại.`)) return;
  try { await api('/api/question-sets/'+set.id,{method:'DELETE'}); await openViewQuestions(); }
  catch(error) { showError(error); }
}
async function moveSelectedQuestions() {
  if (!bankSelected.size || bankMutationBusy) return;
  bankMutationBusy=true; renderBank();
  try { await api('/api/question-sets/contents/move',{...post({questionIds:[...bankSelected],setId:$('#question-set-target').value==='none'?null:Number($('#question-set-target').value)}),method:'PATCH'}); bankSelected.clear(); await openViewQuestions(); toast('Đã chuyển câu hỏi.'); }
  catch(error) { showError(error); }
  finally { bankMutationBusy=false; renderBank(); }
}
async function practiceQuestionSet() {
  if ($('#question-set-filter').value==='all') return toast('Chọn bộ câu hỏi muốn luyện tập.');
  const set=$('#question-set-filter').value;
  const questionIds=state.questions.filter(question=>(set==='none' ? question.setId==null : question.setId===Number(set)) && question.answerStatus==='confirmed').map(question=>question.id);
  if (!questionIds.length) return toast('Bộ này chưa có câu hỏi đã xác nhận đáp án.');
  try { state.attempt=await api('/api/attempts',post({questionIds})); await showQuiz(); }
  catch(error) { showError(error); }
}
