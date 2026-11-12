const state = { questions: [], attempt: null, pending: [], busy: false, importBusy: false, importInvalid: [], importText: null };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const letter = (index) => index == null ? '—' : String.fromCharCode(65 + Number(index));
let accountEpoch = 0;

async function api(url, options = {}) {
  const privateRequest = url.startsWith('/api/') && !url.startsWith('/api/auth/') && !['/api/ai/status','/api/integrations/pdf'].includes(url);
  if (privateRequest && !state.accountId) {
    await loadAccount();
    if (!state.accountId) throw new Error('Bạn cần đăng nhập Google để sử dụng kho dữ liệu cá nhân.');
  }
  const epoch = accountEpoch;
  const account = state.accountId;
  const headers = new Headers(options.headers);
  if (privateRequest) headers.set('X-Quiz-Account', account);
  const response = await fetch(url, { ...options, headers, cache: 'no-store' });
  if (privateRequest && (epoch !== accountEpoch || state.accountId !== account)) throw new Error('Tài khoản đã thay đổi. Phản hồi cũ đã được bỏ qua.');
  if (privateRequest && (response.status === 401 || (response.headers.get('X-Quiz-Account') && response.headers.get('X-Quiz-Account') !== account) || response.status === 409 && !response.headers.get('X-Quiz-Account'))) {
    resetAccountData(null);
    authState = null;
    loadAccount().catch(() => {});
    throw new Error('Phiên đăng nhập đã thay đổi. Hãy đăng nhập lại để tiếp tục.');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (privateRequest && (epoch!==accountEpoch || state.accountId!==account)) throw new Error('Tài khoản đã thay đổi. Dữ liệu cũ được bỏ qua.');
  if (!response.ok) { const error=new Error(data?.error || `HTTP ${response.status}`); error.status=response.status; throw error; }
  if (data?.partial && url.includes('/answer')) {
    const previous=state.attempt;
    if (!previous || previous.id!==data.id || previous.total!==data.total || data.questions.some(question=>!previous.questions.some(old=>old.id===question.id))) return api('/api/attempts/'+data.id);
    const updates=new Map(data.questions.map(question=>[question.id,question]));
    return {...data,partial:false,questions:previous.questions.map(question=>updates.get(question.id)||question)};
  }
  return data;
}
function post(body) { return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
function showError(error) { window.alert(error.message || String(error)); }
function setView(view) {
  document.querySelectorAll('.view-content').forEach((item) => item.classList.toggle('active', item.id === view));
  state.view = view;
}
async function refreshHeader(loadStats = true) {
  const status = await api('/api/ai/status');
  state.teacherEnabled = status.teacherEnabled === true;
  $('#ai-status-label').textContent = status.configured ? (status.connectionVerified ? `${status.provider} đã phản hồi (${status.model})` : `${status.provider} đã cấu hình (${status.model}) — chưa kiểm chứng kết nối`) : 'AI chưa cấu hình: cần khóa API trong .env';
  $('#ai-status-label').style.color = status.configured ? 'var(--color-success)' : 'var(--color-warning)';
  if (!state.accountId) { $('#badge-question-count').textContent = 'Chưa đăng nhập'; return; }
  if (!loadStats) return;
  const stats = await api('/api/stats');
  $('#badge-question-count').textContent = `${stats.total} câu hỏi`;
}
async function loadAIStatus() { try { await refreshHeader(); } catch (error) { $('#ai-status-label').textContent = error.message; } }
function parseQuestionText(text) { return api('/api/imports/preview', post({ text })); }
function setImportBusy(busy) {
  state.importBusy = busy;
  document.querySelectorAll('#v-paste button, #v-paste input, #v-paste textarea, #v-paste select').forEach((element) => { element.disabled = busy; });
}
function suggestionMarkup(question) {
  if (question.answerStatus === 'confirmed' && !question.aiSuggestionReason && question.aiSuggestionIndex == null) return `<p class="preview-status">Đáp án đã xác nhận: ${letter(question.answerIndex)}</p>`;
  if (!question.aiSuggestionReason && question.aiSuggestionIndex == null) return '<p class="preview-status">Chưa có đáp án — cần xem lại hoặc nhờ AI phân tích.</p>';
  return `<div class="ai-suggestion"><strong>AI đề xuất — chưa xác nhận</strong><p>${question.aiSuggestionIndex == null ? 'Cần xem lại: chưa đủ dữ kiện hoặc kết quả AI chưa hợp lệ.' : `Đáp án đề xuất: ${letter(question.aiSuggestionIndex)}`}</p><p>${escapeHtml(question.aiSuggestionReason)}</p></div>`;
}
let importPreviewPage = 1;
let importPreviewMessage = null;
function changeImportPreviewPage(page) {
  try {
    const questions=collectPreview();
    renderImportPreview({questions,invalid:state.importInvalid,aiMessage:importPreviewMessage},page);
    $('#import-preview').scrollIntoView({block:'start'});
  } catch (error) { showError(error); }
}
function renderImportPreview(data, page = 1) {
  state.pending = data.questions || [];
  const pages=Math.max(1,Math.ceil(state.pending.length/25));
  importPreviewPage=Math.min(Math.max(1,page),pages);
  importPreviewMessage=data.aiMessage;
  const start=(importPreviewPage-1)*25;
  state.importInvalid = data.invalid || [];
  const preview = $('#import-preview');
  preview.hidden = false;
  preview.innerHTML = `<h4>${state.pending.length} câu có thể nhập</h4><p id="import-message" role="status">${escapeHtml(data.aiMessage || 'Chọn đáp án và tích xác nhận từng câu. Câu chưa xác nhận vẫn có thể lưu nhưng không được chấm điểm.')}</p>${state.pending.slice(start,start+25).map((question, pageIndex) => {
    const index=start+pageIndex;
    const selected = question.answerIndex ?? question.draftAnswerIndex ?? question.aiSuggestionIndex;
    const confirmed = question.confirmed === true || question.answerStatus === 'confirmed';
    return `<div class="preview-question" data-preview-index="${index}" data-draft-id="${escapeHtml(question.id)}"><h4>Câu ${index + 1}</h4><label>Nội dung câu hỏi<textarea data-prompt rows="2">${escapeHtml(question.prompt)}</textarea></label><div class="preview-options">${question.options.map((option, optionIndex) => `<label>${letter(optionIndex)}<input data-option="${optionIndex}" value="${escapeHtml(option)}"></label>`).join('')}</div><div data-suggestion>${suggestionMarkup(question)}</div><label>Đáp án để xác nhận<select data-answer><option value="">Chưa chọn đáp án</option>${question.options.map((_, optionIndex) => `<option value="${optionIndex}" ${selected === optionIndex ? 'selected' : ''}>${letter(optionIndex)}</option>`).join('')}</select></label><label class="confirm-answer"><input type="checkbox" data-confirm ${confirmed ? 'checked' : ''}> Tôi đã kiểm tra và xác nhận đáp án này</label><p data-confirm-status class="preview-status">${confirmed ? 'Đã xác nhận' : 'Chưa xác nhận — không dùng để chấm điểm'}</p><details><summary>Nội dung đề gốc</summary><pre>${escapeHtml(question.sourceText || question.prompt)}</pre></details></div>`;
  }).join('')}${state.importInvalid.length ? `<p class="preview-error">Không đọc được ${state.importInvalid.length} khối: ${escapeHtml(state.importInvalid.map((item) => `Khối ${item.importIndex}: ${item.error}`).join('; '))}</p>` : ''}<div class="preview-actions"><button class="btn" onclick="cancelImportPreview()">Hủy</button><button class="btn" onclick="analyzePreviewAnswers().catch(showError)">AI đề xuất đáp án</button><button class="btn btn-primary" onclick="saveImportPreview().catch(showError)">Lưu vào kho c? nh?n</button><button class="btn btn-success" onclick="saveImportPreview(true).catch(showError)">Lưu và bắt đầu làm bài</button></div>`;
  if (pages > 1) {
    const pagination=`<div class="preview-pagination"><button class="btn" ${importPreviewPage===1?'disabled':''} onclick="changeImportPreviewPage(${importPreviewPage-1})">Trang trước</button><span>Trang ${importPreviewPage}/${pages} · 25 câu/trang</span><button class="btn" ${importPreviewPage===pages?'disabled':''} onclick="changeImportPreviewPage(${importPreviewPage+1})">Trang sau</button></div>`;
    preview.querySelector('h4').insertAdjacentHTML('afterend',pagination);
    preview.insertAdjacentHTML('beforeend',pagination);
  }
  preview.querySelectorAll('.preview-question').forEach(row => {
    const index=Number(row.dataset.previewIndex);
    const confirmation = row.querySelector('[data-confirm]');
    const updateStatus = () => {
      if (confirmation.checked && row.querySelector('[data-answer]').value === '') confirmation.checked = false;
      row.querySelector('[data-confirm-status]').textContent = confirmation.checked ? 'Đã xác nhận' : 'Chưa xác nhận — không dùng để chấm điểm';
    };
    row.querySelectorAll('[data-prompt], [data-option]').forEach((input) => input.addEventListener('input', () => {
      confirmation.checked = false;
      state.pending[index].aiSuggestionIndex = null;
      state.pending[index].aiSuggestionReason = null;
      row.querySelector('[data-suggestion]').textContent = 'Nội dung đã sửa — cần phân tích lại hoặc xác nhận thủ công.';
      updateStatus();
    }));
    row.querySelector('[data-answer]').addEventListener('change', () => { confirmation.checked = false; updateStatus(); });
    confirmation.addEventListener('change', updateStatus);
  });
}
function collectPreview() {
  const edits=new Map();
  document.querySelectorAll('#import-preview [data-preview-index]').forEach(row => {
    const index=Number(row.dataset.previewIndex);
    const answer = row.querySelector('[data-answer]').value;
    const confirmed = row.querySelector('[data-confirm]').checked && answer !== '';
    const prompt = row.querySelector('[data-prompt]').value.trim();
    const options = [...row.querySelectorAll('[data-option]')].map((input) => input.value.trim());
    if (!prompt || options.some((option) => !option)) throw new Error(`Câu ${index + 1} cần nội dung và đủ bốn lựa chọn. Bản xem trước được giữ lại.`);
    edits.set(index, {
      draftAnswerIndex: answer === '' ? null : Number(answer),
      id: state.pending[index].id,
      prompt,
      options,
      confirmed,
      answerIndex: confirmed ? Number(answer) : null,
      answerStatus: confirmed ? 'confirmed' : 'unconfirmed',
      answerSource: confirmed ? 'user' : (state.pending[index].aiSuggestionReason ? 'ai_suggestion' : 'not_provided'),
      aiSuggestionIndex: state.pending[index].aiSuggestionIndex ?? null,
      aiSuggestionReason: state.pending[index].aiSuggestionReason || null,
      sourceText: state.pending[index].sourceText
    });
  });
  return state.pending.map((question,index)=>edits.get(index)||{...question,confirmed:question.confirmed===true||question.answerStatus==='confirmed'});
}
async function saveImportPreview(start = false) {
  if (state.importBusy) return;
  const questions = collectPreview();
  if (!questions.length) return showError(new Error('Không có câu hợp lệ để lưu.'));
  const confirmedCount = questions.filter((question) => question.confirmed).length;
  if (start && !confirmedCount) throw new Error('Cần xác nhận ít nhất một đáp án trước khi lưu và bắt đầu làm bài.');
  setImportBusy(true);
  $('#import-message').textContent = `Đang lưu ${questions.length} câu hỏi… Bạn có thể chờ tại đây.`;
  try {
    const result = await api('/api/questions/import', post({ questions }));
    state.pending = [];
    state.importText = null;
    $('#import-preview').hidden = true;
    $('#paste-input').value = '';
    await refreshHeader();
    window.alert(`Đã thêm ${result.imported.length} câu vào kho c? nh?n: ${confirmedCount} đã xác nhận, ${result.imported.length - confirmedCount} chờ duyệt.`);
    if (start) {
      // Start the confirmed shared bank rather than resuming an unrelated old attempt.
      state.attempt = await api('/api/attempts', post({}));
      await showQuiz();
    }
  } catch (error) {
    if (state.pending.length && $('#import-message')) $('#import-message').textContent = 'Chưa lưu thành công. Bản xem trước vẫn được giữ lại để thử lại.';
    throw error;
  } finally { setImportBusy(false); }
}
function cancelImportPreview() { if (state.importBusy) return; state.pending = []; state.importText = null; $('#import-preview').hidden = true; }
async function analyzePreviewAnswers() {
  if (state.importBusy || !state.pending.length) return;
  const questions = collectPreview();
  setImportBusy(true);
  $('#import-message').textContent = 'AI đang phân tích đáp án và giải thích...';
  try {
    const data = await api('/api/imports/ai-preview', post({ questions }));
    const byId = new Map(data.questions.map((question) => [question.id, question]));
    // Accept only suggestion fields for the same ID; never replace original text with AI output.
    const merged = questions.map((question) => {
      const result = byId.get(question.id);
      return { ...question, confirmed: false, answerIndex: null, answerStatus: 'unconfirmed', answerSource: 'ai_suggestion', aiSuggestionIndex: result?.aiSuggestionIndex ?? null, aiSuggestionReason: result?.aiSuggestionReason || 'AI chưa có kết quả cho câu này. Cần xem lại.' };
    });
    renderImportPreview({ ...data, questions: merged, invalid: state.importInvalid });
  } catch (error) {
    $('#import-message').textContent = `${error.message} Bản xem trước được giữ lại; bạn có thể xác nhận thủ công.`;
  } finally { setImportBusy(false); }
}
async function handleAIQuestionAnalysis() {
  if (state.importBusy) return;
  const text = $('#paste-input').value.trim();
  if (!text) return showError(new Error('Vui lòng dán văn bản hoặc tải file đề thi trước.'));
  try {
    if (!state.pending.length || state.importText !== text) {
      setImportBusy(true);
      const data = await parseQuestionText(text);
      state.importText = text;
      renderImportPreview(data);
      setImportBusy(false);
    }
    await analyzePreviewAnswers();
  }
  catch (error) { showError(error); }
  finally { setImportBusy(false); }
}
async function handleImportQuestionsManual() {
  if (state.importBusy) return;
  const text = $('#paste-input').value.trim();
  if (!text) return showError(new Error('Vui lòng dán văn bản hoặc tải file đề thi trước.'));
  try {
    setImportBusy(true);
    const data = await parseQuestionText(text);
    if (!data.questions.length) throw new Error(data.invalid?.[0]?.error || 'Không tìm thấy câu hỏi hợp lệ theo form A-D.');
    state.importText = text;
    renderImportPreview(data);
  } catch (error) { showError(error); }
  finally { setImportBusy(false); }
}
async function processLocalFileParsing(event) {
  if (state.importBusy) return;
  const file = event.target.files?.[0];
  if (!file) return;
  $('#file-upload-status-label').textContent = `Đang đọc ${file.name}...`;
  try {
    setImportBusy(true);
    const form = new FormData(); form.append('file', file);
    const data = await api('/api/imports/file', { method: 'POST', body: form });
    $('#paste-input').value = data.text;
    state.pending = []; state.importText = null; $('#import-preview').hidden = true;
    $('#file-upload-status-label').textContent = `Đã đọc thành công file: ${data.fileName}`;
    if (file.name.toLowerCase().endsWith('.docx')) {
      const preview = await parseQuestionText(data.text);
      state.importText = data.text;
      renderImportPreview(preview);
      if (!preview.questions.length) $('#import-message').textContent = 'Đã đọc file Word nhưng chưa tìm thấy câu hỏi đúng định dạng. Kiểm tra mẫu Câu 1:, A–D và Đáp án: hoặc chuẩn hóa lại bằng câu lệnh hướng dẫn.';
      $('#import-preview').scrollIntoView({ block: 'start' });
    }
  } catch (error) { $('#file-upload-status-label').textContent = 'Không thể đọc tệp.'; showError(error); }
  finally { setImportBusy(false); }
}
function backToMenu() { setView('v-menu'); refreshHeader().catch(showError); }
async function openViewQuestions() {
  setView('v-list');
  $('#bankRange').textContent = 'Đang tải kho câu hỏi…';
  try {
    const [questions] = await Promise.all([api('/api/questions'),loadQuestionSets()]);
    state.questions = questions;
    renderBank();
    setView('v-list');
  } catch (error) { renderBank(); showError(error); }
}
async function suggestStoredQuestion(id, button) {
  button.disabled = true;
  button.textContent = 'AI đang phân tích...';
  try { await api(`/api/questions/${id}/ai-suggest`, post({})); await openViewQuestions(); }
  catch (error) { showError(error); }
  finally { button.disabled = false; button.textContent = 'AI đề xuất'; }
}
async function confirmStoredQuestion(id, button) {
  const value = $(`#confirm-question-${id}`).value;
  if (value === '') return showError(new Error('Hãy chọn đáp án trước khi xác nhận.'));
  button.disabled = true;
  try {
    await api(`/api/questions/${id}`, { ...post({ answerIndex: Number(value) }), method: 'PATCH' });
    await openViewQuestions(); await refreshHeader();
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
}
function openView(view) { setView(view); }
async function editQuestionAt(index) {
  try {
    state.questions = await api('/api/questions');
    const question = state.questions[index - 1];
    if (!question) throw new Error('Số thứ tự câu hỏi không tồn tại.');
    $('#edit-index').value = index;
    $('#edit-content').value = `Câu ${index}: ${question.prompt}\n${question.options.map((option, i) => `${letter(i)}. ${option}`).join('\n')}\nĐáp án: ${letter(question.answerIndex)}`;
    setView('v-edit');
  } catch (error) { showError(error); }
}
async function handleEditSave() {
  const index = Number($('#edit-index').value);
  try {
    state.questions = await api('/api/questions');
    const current = state.questions[index - 1];
    if (!current) throw new Error('Số thứ tự câu hỏi cần chỉnh sửa không hợp lệ.');
    const parsed = await parseQuestionText($('#edit-content').value);
    const question = parsed.questions[0];
    if (!question) throw new Error(parsed.invalid?.[0]?.error || 'Khối đề sửa không đúng định dạng.');
    if (question.answerIndex == null) throw new Error('Khối sửa phải có Đáp án: A/B/C/D.');
    await api(`/api/questions/${current.id}`, { ...post({ answerIndex: question.answerIndex, prompt: question.prompt, options: question.options }), method: 'PATCH' });
    window.alert(`Đã cập nhật câu hỏi số ${index}.`);
    backToMenu();
  } catch (error) { showError(error); }
}
async function deleteQuestionAt(index) {
  try {
    const questions = await api('/api/questions');
    const question = questions[index - 1];
    if (!question) throw new Error('Số thứ tự câu cần xóa không tồn tại.');
    if (!window.confirm(`Bạn chắc chắn muốn xóa câu hỏi số ${index}?`)) return;
    await api(`/api/questions/${question.id}`, { method: 'DELETE' });
    window.alert('Xóa câu hỏi thành công.');
    await openViewQuestions();
    await refreshHeader();
  } catch (error) { showError(error); }
}
function handleDeleteAction() { const index = Number($('#delete-index').value); if (!Number.isInteger(index) || index < 1) return showError(new Error('Số thứ tự câu cần xóa không hợp lệ.')); deleteQuestionAt(index); }
async function openWrongLogView() {
  try {
    const wrong = await api('/api/wrong-answers');
    let previousAttempt = null;
    $('#scroller-wrong-list').innerHTML = wrong.length ? wrong.map((question) => {
      const divider = question.attemptId !== previousAttempt ? `<div class="turn-divider">▶ LƯỢT LÀM BÀI THỨ ${question.attemptId}${question.attemptStatus === 'in_progress' ? ' · ĐANG LÀM' : ''}</div>` : '';
      previousAttempt = question.attemptId;
      return `${divider}<article class="question-card data-row"><span class="tag warn">CẦN ÔN</span><p>${escapeHtml(question.prompt)}</p><div class="options">${question.options.map((option, index) => `<div class="option ${index === question.answerIndex ? 'correct' : ''}">${letter(index)}. ${escapeHtml(option)}</div>`).join('')}</div><p class="small muted">Đáp án đúng: ${letter(question.answerIndex)} · Bạn chọn: ${letter(question.selectedIndex)} · ${new Date(question.wrongAt.replace(' ', 'T') + 'Z').toLocaleString('vi-VN')}</p></article>`;
    }).join('') : '<div class="empty">Chưa có câu trả lời sai để ôn. Câu sai sẽ xuất hiện tại đây ngay sau khi bạn chọn đáp án, kể cả khi chưa nộp bài.</div>';
    setView('v-wrong');
  } catch (error) { showError(error); }
}
function exportDataToTxt() { window.location.href = '/api/questions/export'; }
function exportWrongLogToTxt() { window.location.href = '/api/wrong-answers/export'; }
async function startQuizSession(questionIds = null) {
  if (state.practiceLoading) return;
  const load={};state.practiceLoading=load;
  const trigger=document.activeElement;
  const contents=trigger instanceof HTMLButtonElement ? [...trigger.childNodes] : null;
  if (contents) {trigger.disabled=true;trigger.textContent='Đang mở bài…';}
  try {
    const active = await api('/api/attempts/active');
    if (active && active.status === 'in_progress' && window.confirm('Phát hiện một lượt làm bài đang dở. Bạn có muốn làm tiếp không?')) state.attempt = active;
    else state.attempt = await api('/api/attempts', post(questionIds ? { questionIds } : {}));
    await showQuiz();
  } catch (error) { showError(error); }
  finally {if(state.practiceLoading===load)state.practiceLoading=null;if(contents){trigger.replaceChildren(...contents);trigger.disabled=false;}}
}
let practiceRun=0;
let pendingAnswerSave=null;
function resetPracticeInteraction() {
  practiceRun++;
  window.clearTimeout(state.transitionTimer);
  state.answerPending=null;
  state.submitting=null;
  state.navigationPending=false;
  state.savedCursor=null;
  state.busy=false;
  pendingAnswerSave=null;
}
async function showQuiz() {
  resetPracticeInteraction();
  state.savedCursor={id:state.attempt.id,index:state.attempt.currentIndex};
  setView('v-quiz');renderActiveQuestion();await loadChatForCurrentQuestion();
}
function currentQuestion() { return state.attempt?.questions?.[state.attempt.currentIndex]; }
function renderActiveQuestion(message = '') {
  const attempt = state.attempt;
  if (!attempt?.questions?.length) {
    $('#quiz-options-container').replaceChildren();
    $('#quiz-question-container').textContent='Bài này không còn câu hỏi để luyện tập. Hãy tạo bài mới từ kho câu hỏi.';
    $('#quiz-prev-btn').style.display='none';$('#quiz-next-btn').hidden=true;
    return;
  }
  const question = currentQuestion();
  if (!question) return;
  const pending=state.answerPending?.attemptId===attempt.id && state.answerPending?.questionId===question.id ? state.answerPending : null;
  $('#quiz-options-container').setAttribute('aria-busy',String(Boolean(pending)));
  $('#quiz-prev-btn').disabled=Boolean(pending || state.submitting || state.navigationPending);
  $('#quiz-next-btn').hidden=Boolean(pending || !Number.isInteger(question.selectedIndex));
  $('#quiz-next-btn').disabled=Boolean(state.submitting || state.navigationPending);
  $('#quiz-next-btn').textContent=attempt.currentIndex+1<attempt.total ? 'Câu tiếp →' : 'Xem kết quả';
  $('#quiz-progress-lbl').textContent = `Câu ${attempt.currentIndex + 1}/${attempt.total}`;
  const liveScore=attempt.status==='completed' ? attempt.score : attempt.questions.filter(q=>q.selectedIndex!=null && q.selectedIndex===q.answerIndex).length;
  $('#quiz-score-lbl').textContent = `Điểm số: ${liveScore || 0}`;
  $('#quiz-question-container').textContent = question.prompt;
  $('#quiz-options-container').innerHTML = question.options.map((option, index) => {
    const correct = question.answerIndex === option.index;
    const selected = (pending ? pending.selectedIndex : question.selectedIndex) === option.index;
    const resultClass = selected ? (pending ? 'pending' : correct ? 'correct' : 'wrong') : !pending && Number.isInteger(question.selectedIndex) && correct ? 'correct-answer' : '';
    return `<button class="option-item ${resultClass}" ${state.busy ? 'disabled' : ''} data-option-index="${option.index}" aria-pressed="${selected}"><span class="option-badge">${letter(index)}.</span><span>${escapeHtml(option.text)}</span></button>`;
  }).join('');
  document.querySelectorAll('#quiz-options-container .option-item').forEach((item) => item.addEventListener('click', () => chooseAnswer(Number(item.dataset.optionIndex))));
  $('#quiz-prev-btn').style.display = attempt.currentIndex > 0 ? 'inline-flex' : 'none';
  if (message) appendMessageToChatWindow('system', message);
}
async function chooseAnswer(index) {
  if (state.busy || !Number.isInteger(index) || index<0 || index>3) return;
  const question=currentQuestion();if(!question)return;
  const attemptId=state.attempt.id,position=state.attempt.currentIndex,run=practiceRun;
  const nextIndex=Math.min(position+1,state.attempt.total-1);
  state.busy=true;state.answerPending={attemptId,questionId:question.id,selectedIndex:index};
  renderActiveQuestion();
  const request=api('/api/attempts/'+attemptId+'/answer',{...post({feedbackOnly:true,questionId:question.id,selectedIndex:index,currentIndex:nextIndex}),method:'PATCH',signal:AbortSignal.timeout(15000)});
  pendingAnswerSave=request;
  try {
    const saved=await request;
    if (practiceRun!==run || state.attempt?.id!==attemptId || currentQuestion()?.id!==question.id || state.view!=='v-quiz') return;
    if (!saved.feedback || saved.feedback.questionId!==question.id) throw Error('Không nhận được kết quả chấm hợp lệ. Hãy thử lại.');
    question.selectedIndex=saved.feedback.selectedIndex;question.answerIndex=saved.feedback.answerIndex;
    state.attempt.updatedAt=saved.updatedAt;
    state.savedCursor={id:attemptId,index:saved.currentIndex};state.answerPending=null;
    renderActiveQuestion();
    appendMessageToChatWindow('system',saved.feedback.correct ? 'Chính xác!' : `Chưa đúng. Đáp án: ${letter(question.options.findIndex(option=>option.index===question.answerIndex))}.`);
    if (!saved.feedback.correct) runAutoAIEvaluation(question,index);
    state.transitionTimer=window.setTimeout(()=>advancePractice(attemptId,question.id,run),saved.feedback.correct?350:650);
  } catch(error) {
    if (practiceRun!==run || state.attempt?.id!==attemptId) return;
    state.answerPending=null;state.busy=false;
    if (error.status===409) {
      try {state.attempt=await api('/api/attempts/'+attemptId);state.savedCursor={id:attemptId,index:state.attempt.currentIndex};}catch{}
    }
    if (state.view==='v-quiz') {renderActiveQuestion();showError(error.name==='TimeoutError' ? new Error('Chưa nhận được xác nhận lưu từ máy chủ. Hãy kiểm tra kết nối và chọn lại đáp án.') : error);}
  } finally {
    if(pendingAnswerSave===request)pendingAnswerSave=null;
    if(practiceRun===run && state.attempt?.id===attemptId && state.view!=='v-quiz'){state.answerPending=null;state.busy=false;}
  }
}
async function navigatePractice(index) {
  if (!state.attempt || state.answerPending || state.submitting || state.navigationPending || index<0 || index>=state.attempt.total) return;
  window.clearTimeout(state.transitionTimer);
  const attemptId=state.attempt.id,previous=state.attempt.currentIndex,run=practiceRun;
  const saved=state.savedCursor?.id===attemptId && state.savedCursor.index===index;
  state.attempt.currentIndex=index;state.busy=!saved;state.navigationPending=!saved;renderActiveQuestion();
  if (!saved) {
    try {
      const cursor=await api('/api/attempts/'+attemptId+'/cursor',{...post({currentIndex:index}),method:'PATCH',signal:AbortSignal.timeout(15000)});
      if(practiceRun!==run || state.attempt?.id!==attemptId)return;
      state.savedCursor={id:attemptId,index:cursor.currentIndex};state.attempt.updatedAt=cursor.updatedAt;
    } catch(error) {
      if(practiceRun!==run || state.attempt?.id!==attemptId)return;
      state.attempt.currentIndex=previous;showError(error);
    } finally {
      if(practiceRun===run && state.attempt?.id===attemptId){state.busy=false;state.navigationPending=false;if(state.view==='v-quiz')renderActiveQuestion();}
    }
  }
  if(practiceRun===run && state.attempt?.id===attemptId && state.view==='v-quiz')loadChatForCurrentQuestion();
}
async function advancePractice(attemptId=state.attempt?.id,questionId=currentQuestion()?.id,run=practiceRun) {
  if(practiceRun!==run || state.attempt?.id!==attemptId || state.view!=='v-quiz' || currentQuestion()?.id!==questionId || state.answerPending || state.submitting || !Number.isInteger(currentQuestion()?.selectedIndex))return;
  window.clearTimeout(state.transitionTimer);
  if(state.attempt.currentIndex+1<state.attempt.total)await navigatePractice(state.attempt.currentIndex+1);
  else await finishQuiz();
}
async function handleQuizPrev() {
  if(!state.attempt || state.attempt.currentIndex<=0 || state.answerPending || state.submitting)return;
  await navigatePractice(state.attempt.currentIndex-1);
}
async function abortQuizSession() {
  if(!window.confirm('Lưu tiến trình và thoát luyện tập?'))return;
  if(pendingAnswerSave){try{await pendingAnswerSave;}catch{return;}}
  backToMenu();
}
async function finishQuiz() {
  const attemptId=state.attempt?.id,run=practiceRun;
  if(!attemptId || state.attempt.status!=='in_progress')return;
  if(pendingAnswerSave){try{await pendingAnswerSave;}catch{return;}}
  if(practiceRun!==run || state.attempt?.id!==attemptId || state.submitting===attemptId)return;
  state.submitting=attemptId;state.busy=true;window.clearTimeout(state.transitionTimer);renderActiveQuestion();
  $('#practiceFeedback').textContent='Đang tổng kết kết quả…';
  try {
    const result=await api('/api/attempts/'+attemptId+'/submit',{method:'POST',signal:AbortSignal.timeout(30000)});
    if(practiceRun!==run || state.attempt?.id!==attemptId || state.view!=='v-quiz')return;
    state.attempt=result;
    const wrong=result.questions.filter(q=>q.selectedIndex!==q.answerIndex);
    $('#result-score-summary').textContent=`Kết quả: ${result.score}/${result.total} câu chính xác`;
    $('#btn-retest-incorrect-only').style.display=wrong.length?'inline-flex':'none';
    $('#btn-retest-incorrect-only').textContent=`Ôn tập nhanh ${wrong.length} câu làm sai`;
    state.busy=false;setView('v-result');await refreshHeader();
  } catch(error) {
    if(practiceRun===run && state.attempt?.id===attemptId){state.busy=false;if(state.view==='v-quiz')renderActiveQuestion();showError(error);}
  } finally {if(practiceRun===run && state.attempt?.id===attemptId){state.submitting=null;state.busy=false;}}
}

async function retestIncorrectOnly() {
  try { state.attempt = await api(`/api/attempts/${state.attempt.id}/retry-wrong`, { method: 'POST' }); state.busy = false; await showQuiz(); }
  catch (error) { showError(error); }
}
function appendMessageToChatWindow(sender, content) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${sender}`;
  bubble.textContent = content;
  $('#ai-messages-box').appendChild(bubble);
  $('#ai-messages-box').scrollTop = $('#ai-messages-box').scrollHeight;
}
async function loadChatForCurrentQuestion(force=false) {
  if(!state.teacherEnabled && !force){
    $('#ai-messages-box').replaceChildren();
    appendMessageToChatWindow('system','Giáo viên AI đang tạm khóa. Tiến trình luyện tập vẫn được lưu bình thường.');
    return;
  }
  const question = currentQuestion();
  if (!question) return;
  const attemptId = state.attempt.id;
  try {
    const messages = await api(`/api/attempts/${attemptId}/questions/${question.id}/chat`);
    if (state.attempt?.id !== attemptId || currentQuestion()?.id !== question.id || state.view !== 'v-quiz') return;
    const box = $('#ai-messages-box');
    box.innerHTML = '<div class="chat-bubble system">Hãy chọn đáp án bên trái. Nếu cần giải thích, Giáo viên AI sẽ hỗ trợ theo câu đang mở.</div>';
    messages.forEach((message) => appendMessageToChatWindow(message.role === 'assistant' ? 'ai' : message.role, message.content));
  } catch (error) { appendMessageToChatWindow('system', error.message); }
}
let pendingChatRequests = 0;
function setAIStatusIndicator(thinking) {
  pendingChatRequests = Math.max(0, pendingChatRequests + (thinking ? 1 : -1));
  $('#ai-indicator').classList.toggle('thinking', pendingChatRequests > 0);
  $('#chat-thinking').textContent = pendingChatRequests > 0 ? 'Đang phản hồi…' : 'Trợ lý học tập của bạn';
  $('#ai-messages-box').setAttribute('aria-busy', String(pendingChatRequests > 0));
}
async function askAI(message, question = currentQuestion(), attemptId = state.attempt.id) {
  if (!state.teacherEnabled) throw new Error('Giáo viên AI đang tạm khóa.');
  const response = await api(`/api/attempts/${attemptId}/questions/${question.id}/chat`, post({ message }));
  if (state.attempt?.id === attemptId && currentQuestion()?.id === question.id && state.view === 'v-quiz') appendMessageToChatWindow('ai', response.content);
}
async function runAutoAIEvaluation(question, selectedIndex) {
  if (!state.teacherEnabled) return;
  setAIStatusIndicator(true);
  try { await askAI(`Tôi vừa chọn ${letter(question.options.findIndex((option) => option.index === selectedIndex))} và trả lời sai. Hãy giải thích vì sao lựa chọn của tôi chưa đúng và vì sao đáp án đúng phù hợp.`, question); }
  catch (error) { appendMessageToChatWindow('system', error.message); }
  finally { setAIStatusIndicator(false); }
}
async function sendCustomMessageToAI() {
  if (!state.teacherEnabled) return showError(new Error('Giáo viên AI đang tạm khóa.'));
  const input = $('#ai-chat-input-field');
  const text = input.value.trim();
  if (!text || !state.attempt) return;
  input.value = '';
  appendMessageToChatWindow('user', text);
  setAIStatusIndicator(true);
  try { await askAI(text); }
  catch (error) { appendMessageToChatWindow('system', error.message); }
  finally { setAIStatusIndicator(false); }
}
function handleChatFieldKeyPress(event) { if (event.key === 'Enter') { event.preventDefault(); sendCustomMessageToAI(); } }
function resetLearningProgress() {
  if (!window.confirm('Chỉ xóa các phiên đang làm để bắt đầu lại? Kho câu hỏi và lịch sử câu sai đã hoàn thành sẽ được giữ nguyên.')) return;
  api('/api/progress', { method: 'DELETE' }).then(() => { backToMenu(); window.alert('Đã reset tiến trình làm bài.'); }).catch(showError);
}
function hardResetDatabase() {
  if (!window.confirm('CẢNH BÁO: Tùy chọn này sẽ xóa sạch kho câu hỏi và lịch sử. Xác nhận xóa?')) return;
  api('/api/questions/all', { method: 'DELETE' }).then(() => { state.attempt = null; backToMenu(); window.alert('Đã khôi phục cài đặt gốc.'); }).catch(showError);
}
function setupAIStatus() {
  $('#ai-status-check').addEventListener('click', loadAIStatus);
  $('#ai-config-help').addEventListener('click', (event) => { event.preventDefault(); window.alert('Với Gemini, nhập GEMINI_API_KEY và GEMINI_MODEL vào .env rồi khởi động lại server. Khóa chỉ dùng ở backend. Kiểm tra cấu hình không gọi API; trạng thái đã phản hồi chỉ xuất hiện sau một yêu cầu thành công. Không nhập khóa vào trình duyệt.'); });
}
window.openView = openView;
window.backToMenu = backToMenu;
window.startQuizSession = startQuizSession;
window.openViewQuestions = openViewQuestions;
window.openWrongLogView = openWrongLogView;
window.exportDataToTxt = exportDataToTxt;
window.exportWrongLogToTxt = exportWrongLogToTxt;
window.handleAIQuestionAnalysis = handleAIQuestionAnalysis;
window.handleImportQuestionsManual = handleImportQuestionsManual;
window.processLocalFileParsing = processLocalFileParsing;
window.saveImportPreview = saveImportPreview;
window.cancelImportPreview = cancelImportPreview;
window.analyzePreviewAnswers = analyzePreviewAnswers;
window.suggestStoredQuestion = suggestStoredQuestion;
window.confirmStoredQuestion = confirmStoredQuestion;
window.editQuestionAt = editQuestionAt;
window.handleEditSave = handleEditSave;
window.deleteQuestionAt = deleteQuestionAt;
window.handleDeleteAction = handleDeleteAction;
window.handleQuizPrev = handleQuizPrev;
window.abortQuizSession = abortQuizSession;
window.retestIncorrectOnly = retestIncorrectOnly;
window.handleChatFieldKeyPress = handleChatFieldKeyPress;
window.sendCustomMessageToAI = sendCustomMessageToAI;
window.resetLearningProgress = resetLearningProgress;
window.hardResetDatabase = hardResetDatabase;
document.addEventListener('DOMContentLoaded', () => { setupAIStatus(); loadAIStatus(); });
