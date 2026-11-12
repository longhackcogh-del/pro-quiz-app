const viewNames = {'v-menu':'Tổng quan','v-list':'Kho câu hỏi','v-paste':'Nhập tài liệu','v-quiz':'Luyện tập','v-result':'Kết quả','v-wrong':'Lịch sử câu sai','v-edit':'Chỉnh sửa câu hỏi','v-delete':'Xóa câu hỏi','v-settings':'Cài đặt & hướng dẫn','v-help':'Hướng dẫn','v-pdf':'Trợ lý tài liệu PDF'};
let authState = null;
let loginTrigger;
let accountRequest;
let accountBusy = false;
let accountExpiryTimer;
function navigateTo(view) {
  if (view === 'v-list') return openViewQuestions();
  if (view === 'v-wrong') return openWrongLogView();
  if (view === 'v-quiz') return startQuizSession();
  setView(view);
  if (view === 'v-menu' || view === 'v-settings') refreshHeader().catch(showError);
}
function toggleStudyChat(open) {
  const panel = $('#study-chat');
  const expanded = typeof open === 'boolean' ? open : !panel.classList.contains('open');
  panel.classList.toggle('open', expanded);
  if (expanded && state.view==='v-quiz') loadChatForCurrentQuestion(true);
  $('#study-chat-toggle').setAttribute('aria-expanded', String(expanded));
  if (expanded && !$('#ai-chat-input-field').disabled) $('#ai-chat-input-field').focus();
  if (!expanded) $('#study-chat-toggle').focus();
}
function quickChat(message) {
  if (!state.teacherEnabled) return showError(new Error('Giáo viên AI đang tạm khóa.'));
  if (state.view !== 'v-quiz') return showError(new Error('Bắt đầu bài luyện tập để hỏi theo câu hiện tại.'));
  $('#ai-chat-input-field').value = message;
  return sendCustomMessageToAI();
}
function filterQuestionBank() { bankPage = 1; renderBank(); }
async function createNewPractice() {
  if (state.busy || !window.confirm('Tạo lượt luyện tập mới từ toàn bộ câu đã xác nhận?')) return;
  try { state.attempt = await api('/api/attempts', post({})); await showQuiz(); } catch (error) { showError(error); }
}
async function practiceAllWrong() {
  try {
    const wrong = await api('/api/wrong-answers');
    const questionIds = [...new Set(wrong.filter(question => question.answerStatus === 'confirmed').map(question => question.id))];
    if (!questionIds.length) throw new Error('Chưa có câu sai đã xác nhận để ôn.');
    state.attempt = await api('/api/attempts', post({questionIds}));
    state.busy = false;
    await showQuiz();
  } catch (error) { showError(error); }
}
async function resumeAttempt(id) {
  if (state.busy) return;
  try {
    state.attempt = await api(`/api/attempts/${id}`);
    if (state.attempt.status === 'in_progress') await showQuiz();
    else {
      const wrong = state.attempt.questions.filter(question => question.selectedIndex !== question.answerIndex);
      $('#result-score-summary').textContent = `Kết quả: ${state.attempt.score}/${state.attempt.total} câu chính xác`;
      $('#btn-retest-incorrect-only').style.display = wrong.length ? '' : 'none';
      setView('v-result');
    }
  } catch (error) { showError(error); }
}
const originalSetView = setView;
setView = function(view) {
  if (state.view==='v-quiz' && view!=='v-quiz') resetPracticeInteraction();
  originalSetView(view);
  $('#view-title').textContent = viewNames[view] || 'PRO QUIZ';
  const group = view === 'v-result' ? 'v-quiz' : ['v-help','v-reset'].includes(view) ? 'v-settings' : view;
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === group;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  syncTeacherAvailability();
  window.scrollTo(0,0);
};
function syncTeacherAvailability() {
  const learning = state.view === 'v-quiz' && state.teacherEnabled === true;
  $('#ai-chat-input-field').disabled = !learning;
  $('#chat-send').disabled = !learning;
  document.querySelectorAll('.chat-suggestions button').forEach(button => { button.disabled = !learning; });
  $('#chat-context').textContent = !state.teacherEnabled ? 'Giáo viên AI đang tạm khóa. Lịch sử hội thoại được giữ nguyên.' : learning ? 'Hỏi theo câu đang làm · Hội thoại được lưu riêng' : 'Bắt đầu hoặc tiếp tục bài luyện tập để hỏi Giáo viên AI.';
  $('#ai-chat-input-field').placeholder = state.teacherEnabled ? 'Nhập tin nhắn…' : 'Giáo viên AI đang tạm khóa';
  $('#chat-thinking').textContent = state.teacherEnabled ? 'Trợ lý học tập của bạn' : 'Đang tạm khóa';
}
const originalRefreshHeader = refreshHeader;
refreshHeader = async function() {
  const [,dashboard] = await Promise.all([originalRefreshHeader(false),state.accountId ? api('/api/dashboard') : Promise.resolve(null)]);
  syncTeacherAvailability();
  $('#dashboard-ai-status').textContent = $('#ai-status-label').textContent;
  $('#ai-verified-badge').textContent = $('#ai-status-label').textContent.includes(' đã phản hồi (') ? 'Đã phản hồi' : 'Chưa xác minh';
  if (!state.accountId) return;
  if (!dashboard) return;
  $('#badge-question-count').textContent = `${dashboard.total} câu hỏi`;
  $('#statTotal').textContent = dashboard.total;
  $('#statConfirmed').textContent = dashboard.confirmed;
  $('#statSessions').textContent = dashboard.completedAttempts;
  $('#statAccuracy').textContent = dashboard.accuracy === null ? '—' : `${dashboard.accuracy}%`;
  $('#recent-attempts').innerHTML = dashboard.recent.length ? dashboard.recent.map(attempt => {
    const completed = attempt.status === 'completed';
    const progress = attempt.total ? Math.round((completed ? attempt.total : attempt.answered) * 100 / attempt.total) : 0;
    return `<div class="row-item"><div class="stat-icon">${completed ? '✓' : '▷'}</div><div class="grow"><b>Lượt luyện tập #${attempt.id}</b><small>${attempt.total} câu · ${new Date(attempt.updatedAt.replace(' ','T')+'Z').toLocaleString('vi-VN')}</small><div class="progress"><i style="width:${progress}%"></i></div></div><button class="btn ${completed ? '' : 'primary'}" onclick="resumeAttempt(${attempt.id})">${completed ? `Kết quả ${attempt.score}/${attempt.total}` : 'Tiếp tục'}</button></div>`;
  }).join('') : '<p class="empty">Chưa có lượt luyện tập. Nhập câu hỏi và bắt đầu hành trình của bạn.</p>';
};
const originalRenderQuestion = renderActiveQuestion;
renderActiveQuestion = function(message = '') {
  originalRenderQuestion(message);
  if (!state.attempt?.total) return;
  $('#practiceBar').style.width = `${(state.attempt.currentIndex + 1) * 100 / state.attempt.total}%`;
  $('#practiceNumber').textContent = `QUESTION ${String(state.attempt.currentIndex + 1).padStart(2,'0')}`;
  const question = currentQuestion();
  if (state.answerPending?.attemptId===state.attempt.id && state.answerPending?.questionId===question.id) { $('#practiceFeedback').textContent='Đang chấm và lưu lựa chọn…'; return; }
  $('#practiceFeedback').textContent = question.selectedIndex == null ? 'Chọn đáp án để ghi nhận kết quả.' : question.selectedIndex === question.answerIndex ? '✓ Chính xác! Tiến trình đã được lưu.' : `Chưa đúng. Đáp án đã xác nhận: ${letter(question.options.findIndex(option=>option.index===question.answerIndex))}.`;
};
let toastTimer;
function toast(message) {
  $('#app-toast').textContent = message;
  $('#app-toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#app-toast').classList.remove('show'),6500);
}
showError = function(error) { toast(error.message || String(error)); };
function loginFeedback(message) {
  $('#login-feedback').textContent = message;
  $('#login-feedback').hidden = !message;
}
function resetAccountData(accountId) {
  resetPracticeInteraction();
  state.practiceLoading=null;
  questionSets=[]; renderQuestionSets();
  $('#question-set-filter').value='all';
  accountEpoch++;
  clearTimeout(state.transitionTimer);
  state.accountId = accountId;
  state.questions = []; state.attempt = null; state.pending = []; state.importInvalid = [];
  state.importText = null; state.busy = false; state.importBusy = false;
  bankSelected.clear(); bankAnswerDrafts.clear(); bankPage = 1;
  if ($('#editModal').classList.contains('open')) closeEdit();
  for (const id of ['scroller-questions-list','scroller-wrong-list','quiz-options-container','quiz-question-container','result-score-summary','ai-messages-box','import-preview','recent-attempts']) {
    // Preserve the table scaffold; renderBank below clears its rows.
    if (id !== 'scroller-questions-list') $('#'+id).replaceChildren();
  }
  for (const id of ['paste-input','edit-content','edit-index','delete-index','ai-chat-input-field','file-selector-input','prepared-word-input','chapter-word-input']) { const input=$('#'+id); if(input) input.value=''; }
  $('#editQuestion').value=''; $('#editOptions').replaceChildren(); $('#editCorrect').value=''; $('#editConfirmed').checked=false;
  $('#quiz-score-lbl').textContent='Điểm số: 0'; $('#quiz-progress-lbl').textContent=''; $('#practiceFeedback').textContent=''; $('#practiceNumber').textContent=''; $('#practiceBar').style.width='0%';
  $('#sideName').textContent='Chưa đăng nhập'; $('#sideEmail').textContent=''; $('#sideAvatar').textContent='G'; $('#account-button').textContent='Đăng nhập Google';
  $('#account-profile').hidden=true; $('#profile-name').textContent=''; $('#profile-email').textContent=''; $('#profile-expiry').textContent='';
  $('#import-preview').hidden = true;
  $('#file-upload-status-label').textContent = 'Chưa chọn tệp';
  $('#bank-search').value = ''; $('#bank-filter').value = 'all';
  renderBank(); setImportBusy(false);
  for (const id of ['statTotal','statConfirmed','statSessions']) $('#'+id).textContent = '0';
  $('#statAccuracy').textContent = '—';
  $('#badge-question-count').textContent = accountId ? '0 câu hỏi' : 'Chưa đăng nhập';
  $('#recent-attempts').textContent = accountId ? 'Đang tải dữ liệu tài khoản…' : 'Đăng nhập Google để xem bài luyện tập của bạn.';
  $('#app-toast').classList.remove('show');
  pendingChatRequests = 0;
  setView('v-menu');
}
function renderAccount() {
  if (!authState) return;
  $('#sideName').textContent = authState.user?.name || 'Khách học tập';
  $('#sideEmail').textContent = authState.user?.email || 'Chưa đăng nhập';
  $('#sideAvatar').textContent = authState.user ? authState.user.name.charAt(0).toUpperCase() : 'G';
  $('#account-button').textContent = authState.user ? 'Tài khoản' : 'Đăng nhập Google';
  const details = authState.configured ? 'Google OAuth đã cấu hình. Đăng nhập qua Google để xác thực danh tính.' : `Google OAuth chưa sẵn sàng. ${authState.missing.length ? 'Thiếu: '+authState.missing.join(', ')+'.' : ''}${!authState.validRedirect ? ' Kiểm tra GOOGLE_REDIRECT_URI (đường dẫn /auth/google/callback).' : ''}`;
  $('#account-status').textContent = authState.user ? `Đã xác thực: ${authState.user.email}. Kho câu hỏi và tiến trình chỉ thuộc tài khoản này.` : details;
  $('#oauth-status').textContent = authState.user ? 'Dữ liệu cá nhân được lưu theo tài khoản Google. Phiên đăng nhập kết thúc khi hết hạn hoặc máy chủ khởi động lại.' : authState.configured ? 'Đăng nhập Google để mở kho câu hỏi và tiến trình của riêng bạn.' : 'Đăng nhập Google chưa được quản trị viên thiết lập.';
  $('#google-login-button').disabled = accountBusy || (!authState.user && !authState.configured);
  $('#google-login-button').textContent = accountBusy ? (authState.user ? 'Đang đăng xuất…' : 'Đang chuyển đến Google…') : authState.user ? 'Đăng xuất khỏi tài khoản' : 'G  Tiếp tục với Google';
  $('#google-login-button').classList.toggle('google', !authState.user);
  $('#google-login-button').classList.toggle('danger', Boolean(authState.user));
  $('#login-title').textContent = authState.user ? 'Tài khoản của bạn' : 'Đăng nhập PRO QUIZ';
  $('#login-description').textContent = authState.user ? 'Quản lý phiên đăng nhập Google của bạn.' : 'Xác thực bằng Google. Bạn có thể tiếp tục học với chế độ khách.';
  $('#login-close').textContent = authState.user ? 'Đóng' : 'Tiếp tục với khách';
  $('#account-profile').hidden = !authState.user;
  $('#profile-name').textContent = authState.user?.name || '';
  $('#profile-email').textContent = authState.user?.email || '';
  $('#profile-avatar').textContent = authState.user?.name.charAt(0).toUpperCase() || '';
  $('#profile-expiry').textContent = authState.expiresAt ? 'Phiên hết hạn: '+new Date(authState.expiresAt).toLocaleString('vi-VN') : '';
}
async function loadAccount() {
  if (accountRequest) return accountRequest;
  accountRequest = (async () => {
    try {
      const previousUser = authState?.user;
      authState = await api('/api/auth/status');
      const changed = (state.accountId || null) !== (authState.user?.id || null);
      if (changed || !state.accountId) resetAccountData(authState.user?.id || null);
      renderAccount();
      if (changed && authState.user) await refreshHeader();
      clearTimeout(accountExpiryTimer);
      if (authState.expiresAt) accountExpiryTimer = setTimeout(() => loadAccount().catch(() => {}), Math.max(1000,new Date(authState.expiresAt).getTime()-Date.now()+250));
      if (previousUser && !authState.user && !accountBusy) toast('Phiên đăng nhập đã kết thúc. Dữ liệu cá nhân đã được ẩn.');
      return authState;
    } catch (error) {
      $('#google-login-button').disabled = true;
      $('#oauth-status').textContent = 'Không kiểm tra được đăng nhập. Hãy thử lại khi kết nối ổn định.';
      throw error;
    } finally { accountRequest = null; }
  })();
  return accountRequest;
}
async function retryAccount() {
  $('#account-retry').disabled = true;
  loginFeedback('Đang kiểm tra kết nối…');
  try { await loadAccount(); loginFeedback('Đã cập nhật trạng thái đăng nhập.'); }
  catch { loginFeedback('Không thể kết nối máy chủ. Vui lòng thử lại.'); }
  finally { $('#account-retry').disabled = false; }
}
async function openLogin(forceDialog = false) {
  if (!forceDialog) {
    try {
      await loadAccount();
      if (authState.configured && !authState.user) return startGoogleLogin();
    } catch { /* Show the existing retry dialog when the server is unavailable. */ }
  }
  loginTrigger = document.activeElement;
  $('#loginScreen').classList.add('open');
  loginFeedback('');
  $('#loginScreen .btn.ghost').focus();
  try { await loadAccount(); } catch { loginFeedback('Không tải được trạng thái đăng nhập. Vui lòng kiểm tra lại kết nối.'); }
}
function closeLogin() { $('#loginScreen').classList.remove('open'); loginTrigger?.focus(); }
async function startGoogleLogin() {
  if (accountBusy || !authState) return;
  if (!authState.user && !authState.configured) return loginFeedback('Đăng nhập Google chưa được thiết lập. Bạn có thể tiếp tục với chế độ khách.');
  accountBusy = true;
  loginFeedback('');
  renderAccount();
  if (authState.user) {
    try { if (accountRequest) await accountRequest; await api('/api/auth/logout',{method:'POST'}); resetAccountData(null); authState={...authState,user:null,expiresAt:null}; renderAccount(); authEvents?.postMessage('changed'); await loadAccount(); closeLogin(); toast('Đã đăng xuất.'); }
    catch { loginFeedback('Đăng xuất chưa thành công. Hãy kiểm tra kết nối rồi thử lại.'); }
    finally { accountBusy = false; renderAccount(); }
  } else {
    window.location.assign(authState.loginUrl);
  }
}

window.addEventListener('focus', () => { if (document.readyState === 'complete' && !accountBusy) loadAccount().catch(() => {}); });
window.addEventListener('pageshow', event => { if (event.persisted) { accountBusy = false; authState=null; resetAccountData(null); loadAccount().catch(() => {}); } });
const authEvents = typeof BroadcastChannel === 'function' ? new BroadcastChannel('pro-quiz-account') : null;
if (authEvents) authEvents.onmessage = () => { resetAccountData(null); authState=null; loadAccount().catch(() => {}); };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if ($('#loginScreen').classList.contains('open')) closeLogin(); else if ($('#study-chat').classList.contains('open')) toggleStudyChat(false); }
  if (event.key === 'Tab' && $('#loginScreen').classList.contains('open')) {
    const buttons = [...$('#loginScreen').querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
document.addEventListener('DOMContentLoaded', () => {
  setView(state.view || 'v-menu');
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => navigateTo(button.dataset.view)));
  document.querySelectorAll('.quick-card').forEach(card => { card.setAttribute('role','button'); card.tabIndex=0; card.addEventListener('keydown',event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); } }); });
  resetAccountData(null);
  loadAccount().catch(showError);
  api('/api/integrations/pdf').then(status => {
    $('#pdf-status').textContent = status.configured ? 'Đã cấu hình địa chỉ trợ lý. Mở trong tab mới; khả năng trả lời phụ thuộc dịch vụ PDF.' : 'Chưa cấu hình CHATBOT_URL tới ứng dụng PDF ở cổng riêng.';
    $('#pdf-link').setAttribute('aria-disabled',String(!status.configured));
    if (!status.configured) $('#pdf-link').addEventListener('click',event => { event.preventDefault(); toast('Cấu hình CHATBOT_URL tới ứng dụng PDF ở cổng khác rồi khởi động lại server.'); });
  }).catch(showError);
  const zone = $('.upload-zone');
  $('#file-selector-input').hidden = false;
  zone.addEventListener('dragover',event => { event.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave',() => zone.classList.remove('drag-over'));
  zone.addEventListener('drop',event => { event.preventDefault(); zone.classList.remove('drag-over'); processLocalFileParsing({target:{files:event.dataTransfer.files}}); });
  const params = new URLSearchParams(window.location.search);
  if (params.has('auth')) {
    const messages = {success:'Google đã xác thực thành công.',cancelled:'Bạn đã hủy đăng nhập.',invalid_state:'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Hãy thử lại.',failed:'Google chưa xác thực được. Kiểm tra cấu hình và thử lại.'};
    if (params.get('auth') !== 'success') openLogin(true).then(() => loginFeedback(messages[params.get('auth')] || 'Không xác định được kết quả đăng nhập.'));
    else loadAccount().then(() => {
      if (authState.user) { authEvents?.postMessage('changed'); toast(messages.success); }
      else openLogin(true).then(() => loginFeedback('Không tìm thấy phiên đăng nhập. Hãy cho phép cookie và thử đăng nhập lại.'));
    }).catch(showError);
    history.replaceState(null,'',window.location.pathname);
  }
});
