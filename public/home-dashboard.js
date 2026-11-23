let homeActiveAttemptId=null;
function renderHomeDashboard(dashboard){
  homeActiveAttemptId=dashboard?.activeAttemptId??null;
  const active=dashboard?.recent.find(attempt=>attempt.id===homeActiveAttemptId);
  const progress=active?.total?Math.min(100,Math.round(active.answered*100/active.total)):0;
  $('#home-study-status').textContent=active?`Lượt #${active.id} · Đã trả lời ${active.answered}/${active.total} câu`:homeActiveAttemptId?'Bài đang dở đã được lưu. Tiếp tục khi bạn sẵn sàng.':'Chọn một bộ câu hỏi và bắt đầu từ những bước nhỏ.';
  $('#home-study-progress').hidden=!active;$('#home-study-progress i').style.width=progress+'%';
  $('#home-study-action').textContent=homeActiveAttemptId?'Tiếp tục học →':'Bắt đầu học →';
  $('#home-learning-note').textContent=dashboard?`${dashboard.confirmed} câu đã xác nhận, sẵn sàng để luyện tập. Chọn một hoặc nhiều bộ trong thư viện để học theo nhu cầu.`:'Đăng nhập Google để lưu riêng bộ câu hỏi và tiến trình học của bạn.';
}
function continueDashboardStudy(){return homeActiveAttemptId?resumeAttempt(homeActiveAttemptId):navigateTo('v-quiz');}
function renderHomeLibrary(){
  const folders=questionFolders.slice(0,4);
  $('#home-folders').innerHTML=folders.map(folder=>{const sets=questionSets.filter(set=>set.folderId===folder.id);return `<button class="home-folder" onclick="openHomeFolder(${folder.id})"><span class="home-folder-icon" aria-hidden="true">▱</span><span><strong>${escapeHtml(folder.name)}</strong><small>${sets.length} bộ · ${sets.reduce((sum,set)=>sum+set.questionCount,0)} câu</small></span><span aria-hidden="true">›</span></button>`;}).join('')||'<p class="home-empty">Tạo thư mục theo môn học để giữ mọi bộ câu hỏi gọn gàng.</p>';
  $('#home-sets').innerHTML=questionSets.slice(-3).reverse().map(set=>`<article class="home-set"><span class="home-set-icon" aria-hidden="true">▤</span><div><strong>${escapeHtml(set.name)}</strong><small>${set.questionCount} câu hỏi${set.folderId!=null?' · '+escapeHtml(questionFolders.find(folder=>folder.id===set.folderId)?.name||''):''}</small></div><button class="btn" onclick="openHomeSet(${set.id})">Mở bộ →</button></article>`).join('')||'<p class="home-empty">Chưa có bộ câu hỏi. Nhập đề đầu tiên để bắt đầu học.</p>';
}
async function openHomeFolder(id){await openViewQuestions();openQuestionFolder(id);}
async function openHomeSet(id){await openViewQuestions();openLibrarySet(id);}
async function createHomeFolder(){await openViewQuestions();return createQuestionFolder();}
