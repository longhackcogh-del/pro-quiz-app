// Native Chrome DevTools + Node built-ins: no browser automation dependency.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const browserPath = [
  process.env.PRO_QUIZ_TEST_BROWSER,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => candidate && fs.existsSync(candidate));

test('Browser: proposal stays unconfirmed, edits invalidate it, save starts the shared bank, missing key keeps preview', { skip: !browserPath, timeout: 60000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-quiz-browser-'));
  process.env.DATABASE_FILE = path.join(directory, 'test.sqlite');
  process.env.GEMINI_API_KEY = '';
  process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
  process.env.QUIZ_TEACHER_ENABLED = 'true';
  process.env.GOOGLE_CLIENT_ID = '';
  process.env.GOOGLE_CLIENT_SECRET = '';
  process.env.GOOGLE_REDIRECT_URI = '';
  const provider = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    if (!payload.response_format) {
      if (payload.messages.at(-1).content === 'slow') await new Promise((resolve) => setTimeout(resolve, 150));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'MOCK OPENAI CHAT RESPONSE' } }] }));
      return;
    }
    const input = JSON.parse(payload.messages.at(-1).content);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ suggestions: input.map((question) => ({ id: question.id, answerIndex: question.prompt.includes('passage') ? null : 3, needsReview: question.prompt.includes('passage'), reason: question.prompt.includes('passage') ? 'Thiếu đoạn văn để suy luận.' : 'Before nghĩa là trước khi.', prompt: 'DO NOT USE AI TEXT' })).reverse() }) } }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  process.env.OPENAI_API_URL = `http://127.0.0.1:${provider.address().port}`;
  // Inject Google responses only in this isolated test process; the browser still uses real HTTP cookies and callbacks.
  const actualFetch = global.fetch;
  global.fetch = async (url,options) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({access_token:'test-google-token'});
    if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({sub:'browser-google-user',name:'Browser Test User',email:'browser@example.com',email_verified:true});
    return actualFetch(url,options);
  };
  let app;
  try { app = require('../server/app'); } finally { global.fetch = actualFetch; }
  const db = require('../server/database');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  let socket;
  let browser;
  t.after(async () => {
    if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' })); socket.close(); }
    if (browser && browser.exitCode === null) await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (browser && browser.exitCode === null) browser.kill();
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => provider.close(resolve))]);
    db.close();
    const target = path.resolve(directory);
    if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('pro-quiz-browser-')) fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  // Only the temporary headless browser in Linux CI needs these runner flags.
  const ciFlags=process.env.CI && process.platform==='linux' ? ['--no-sandbox','--disable-dev-shm-usage'] : [];
  browser = spawn(browserPath, ['--headless=new', ...ciFlags, '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${path.join(directory, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Browser DevTools did not start: '+buffer.slice(-2000))), 15000);
    browser.once('error', (error) => { clearTimeout(timer); reject(error); });
    browser.once('exit', code => { clearTimeout(timer); reject(new Error('Test browser exited '+code+': '+buffer.slice(-2000))); });
    browser.stderr.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); callback(message); }
  });
  async function send(method, params = {}, sessionId) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools timeout: ${method}`)); }, 15000);
      pending.set(id, (message) => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId).catch(error => { throw new Error(error.message+' while evaluating: '+expression.slice(0,200)); });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression) {
    for (let index = 0; index < 100; index++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Browser condition did not become true: ${expression}`);
  }
  async function screenshot(name) {
    if (!process.env.PRO_QUIZ_CAPTURE_SCREENSHOTS) return;
    await evaluate("document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).forEach(animation => animation.finish())");
    const captureDirectory = path.resolve(__dirname, '..', 'artifacts', 'ui-review');
    fs.mkdirSync(captureDirectory, {recursive:true});
    const result = await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
    fs.writeFileSync(path.join(captureDirectory,name+'.png'),Buffer.from(result.data,'base64'));
  }
  const designMetrics = `JSON.stringify({sidebar:getComputedStyle(document.querySelector('.sidebar')).width,background:getComputedStyle(document.body).backgroundColor,hero:getComputedStyle(document.querySelector('.hero-main')).backgroundImage,radius:getComputedStyle(document.querySelector('.hero-main')).borderRadius,font:getComputedStyle(document.body).fontFamily})`;
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sessionId);
  await send('Page.navigate',{url:pathToFileURL(path.resolve(__dirname,'..','PRO_QUIZ_APP_kho_cau_hoi.html')).href},sessionId);
  await until("document.readyState === 'complete' && !!document.querySelector('#home')");
  const prototypeMetrics = await evaluate(designMetrics);
  await screenshot('prototype-desktop');
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` }, sessionId);
  await until("typeof handleAIQuestionAnalysis === 'function' && document.readyState === 'complete'");
  await until("document.querySelector('#statTotal').textContent === '0' && authState !== null");
  assert.equal(await evaluate(designMetrics),prototypeMetrics);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#study-chat')).display"),'none');
  await evaluate('toggleStudyChat(true)');
  assert.equal(await evaluate("Math.round(document.querySelector('#study-chat').getBoundingClientRect().width)"),330);
  assert.equal(await evaluate("Math.round(document.querySelector('#study-chat').getBoundingClientRect().height)"),430);
  assert.equal(await evaluate("document.querySelector('#study-chat-toggle').getAttribute('aria-expanded')"),'true');
  await screenshot('app-desktop-chat');
  await evaluate('toggleStudyChat(false); openLogin()');
  assert.equal(await evaluate("document.querySelector('#google-login-button').disabled"),true);
  assert.equal(await evaluate("document.querySelector('#sideName').textContent"),'Khách học tập');
  await screenshot('app-login');
  async function signBrowserIn() {
    const base='http://127.0.0.1:'+server.address().port;
    const cookie=await require('./auth-client').signIn(base);
    await send('Network.setCookie',{name:'quiz_session',value:cookie.slice('quiz_session='.length),url:base,httpOnly:true,sameSite:'Lax'},sessionId);
    await evaluate('loadAccount()');
  }
  await signBrowserIn();
  await evaluate('closeLogin()');
  await evaluate("window.testAlerts=[]; window.alert=(message)=>window.testAlerts.push(message); window.confirm=()=>true; openView('v-paste')");
  const text = '1. Could you check the departure time .............. we leave for the airport? A. throughout B. during C. until D. before\n\n2. According to the passage, why did he leave? A. Work B. Study C. Travel D. Family';
  await evaluate(`document.querySelector('#paste-input').value=${JSON.stringify(text)}; handleAIQuestionAnalysis()`);
  assert.equal(await evaluate('state.pending.length'), 2);
  assert.equal(await evaluate("document.querySelector('[data-answer]').value"), '3');
  assert.equal(await evaluate("document.querySelector('[data-confirm]').checked"), false);
  assert.ok(await evaluate("document.querySelector('#import-preview').textContent.includes('AI đề xuất — chưa xác nhận')"));
  assert.ok(await evaluate("document.querySelectorAll('[data-suggestion]')[1].textContent.includes('Cần xem lại')"));
  assert.equal(await evaluate('collectPreview()[0].answerIndex'), null);
  await evaluate('saveImportPreview(true).catch(showError)');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM questions').get().count, 0);
  await evaluate("document.querySelector('[data-confirm]').click(); const prompt=document.querySelector('[data-prompt]'); prompt.value += ' (reviewed)'; prompt.dispatchEvent(new Event('input', {bubbles:true}))");
  assert.equal(await evaluate("document.querySelector('[data-confirm]').checked"), false);
  assert.equal(await evaluate('state.pending[0].aiSuggestionIndex'), null);
  await evaluate('analyzePreviewAnswers()');
  assert.ok((await evaluate("document.querySelector('[data-prompt]').value")).endsWith('(reviewed)'));
  assert.ok(!(await evaluate("document.querySelector('#import-preview').textContent")).includes('DO NOT USE AI TEXT'));
  await evaluate("document.querySelector('[data-confirm]').click(); saveImportPreview(true)");
  assert.equal(await evaluate('state.view'), 'v-quiz');
  assert.equal(await evaluate('state.attempt.total'), 1);
  await evaluate("document.querySelector('#ai-chat-input-field').value='Explain'; sendCustomMessageToAI()");
  assert.equal(await evaluate("document.querySelector('#ai-messages-box .chat-bubble.ai').textContent"), 'MOCK OPENAI CHAT RESPONSE');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_messages').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM questions').get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM questions WHERE answer_status='confirmed'").get().count, 1);
  assert.equal(db.prepare('SELECT source_text FROM questions ORDER BY id LIMIT 1').get().source_text, text.split('\n\n')[0]);
  await evaluate('openViewQuestions()');
  await screenshot('app-question-bank');
  const pendingId = db.prepare("SELECT id FROM questions WHERE answer_status='unconfirmed'").get().id;
  await evaluate(`suggestStoredQuestion(${pendingId}, document.querySelector('#scroller-questions-list button'))`);
  assert.equal(db.prepare('SELECT answer_index FROM questions WHERE id=?').get(pendingId).answer_index, null);
  await evaluate(`document.querySelector('#confirm-question-${pendingId}').value='1'; confirmStoredQuestion(${pendingId}, document.querySelector('#scroller-questions-list button'))`);
  assert.equal(db.prepare('SELECT answer_index FROM questions WHERE id=?').get(pendingId).answer_index, 1);
  await evaluate("(async()=>{state.attempt=await api('/api/attempts',post({})); await showQuiz(); document.querySelector('#ai-chat-input-field').value='slow'; const pending=sendCustomMessageToAI(); state.attempt.currentIndex=1; await showQuiz(); await pending;})()");
  assert.equal(await evaluate("document.querySelector('#ai-messages-box .chat-bubble.ai') === null"), true);
  // Same frontend with no API key: actual upload + manual confirmation still work.
  process.env.OPENAI_API_KEY = '';
  await evaluate(`openView('v-paste'); processLocalFileParsing({target:{files:[new File([${JSON.stringify(text.split('\n\n')[0])}], 'exam.txt', {type:'text/plain'})]}})`);
  assert.ok(await evaluate("document.querySelector('#file-upload-status-label').textContent.includes('Đã đọc thành công')"));
  await evaluate('handleAIQuestionAnalysis()');
  assert.equal(await evaluate('state.pending.length'), 1);
  assert.ok(await evaluate("document.querySelector('#import-message').textContent.includes('Chưa kết nối AI')"));
  assert.equal(await evaluate("document.querySelector('[data-prompt]').value"), 'Could you check the departure time .............. we leave for the airport?');
  await evaluate("document.querySelector('[data-answer]').value='3'; document.querySelector('[data-confirm]').click(); saveImportPreview(true)");
  assert.equal(await evaluate('state.attempt.total'), 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM questions').get().count, 3);
  await evaluate('openViewQuestions()');
  await evaluate("window.prompt=()=> 'Chapter 1'; createQuestionSet()");
  assert.equal(await evaluate('questionSets.length'),1);
  await evaluate("toggleQuestionSelection(state.questions[0].id,true); document.querySelector('#question-set-target').value=String(questionSets[0].id); moveSelectedQuestions()");
  assert.equal(await evaluate('filteredBankQuestions().length'),1);
  await evaluate('window.beforeSetPractice=state.attempt; practiceQuestionSet()');
  assert.equal(await evaluate('state.attempt.total'),1);
  await evaluate('state.attempt=window.beforeSetPractice; openViewQuestions()');
  await evaluate("window.prompt=()=> 'Renamed chapter'; renameQuestionSet()");
  assert.equal(await evaluate('selectedQuestionSet().name'),'Renamed chapter');
  await evaluate('deleteQuestionSet()');
  assert.equal(await evaluate('questionSets.length'),0);
  assert.equal(await evaluate('state.questions.length'),3);
  await evaluate("document.querySelector('#bank-search').value='no-such-question-xyz'; filterQuestionBank()");
  assert.equal(await evaluate("document.querySelector('#bank-empty').hidden"),false);
  await evaluate("document.querySelector('#bank-search').value=''; filterQuestionBank()");
  await evaluate('showQuiz()');
  const sourceAttemptId = await evaluate('state.attempt.id');
  await evaluate('chooseAnswer((state.questions.find(q=>q.id===currentQuestion().id).answerIndex+1)%4)');
  await evaluate('openWrongLogView()');
  assert.equal(await evaluate("document.querySelectorAll('#scroller-wrong-list .question-card').length"),1);
  assert.ok(await evaluate("document.querySelector('#scroller-wrong-list').textContent.includes('ĐANG LÀM')"));
  await evaluate('practiceAllWrong()');
  const earlyReviewId = await evaluate('state.attempt.id');
  assert.notEqual(earlyReviewId,sourceAttemptId);
  assert.equal(await evaluate('state.attempt.total'),1);
  assert.equal(await evaluate('state.busy'),false);
  // The original answer's delayed navigation must not submit or modify the new review.
  await new Promise(resolve=>setTimeout(resolve,2800));
  assert.equal(await evaluate('state.attempt.id'),earlyReviewId);
  assert.equal(await evaluate('state.attempt.status'),'in_progress');
  assert.equal(await evaluate('currentQuestion().selectedIndex'),null);
  assert.equal((await evaluate(`api('/api/attempts/${sourceAttemptId}')`)).currentIndex,1);
  await evaluate(`(async()=>{await api('/api/attempts/${sourceAttemptId}/cursor',{...post({currentIndex:0}),method:'PATCH'});state.attempt=await api('/api/attempts/${sourceAttemptId}');await showQuiz()})()`);
  for (let index=0; index<3; index++) {
    await evaluate("(()=>{const wrong=[...document.querySelectorAll('.option-item')].find(button => Number(button.dataset.optionIndex)!==state.questions.find(q=>q.id===currentQuestion().id).answerIndex);wrong.click()})()");
    await until(index===2 ? "state.view === 'v-result'" : `state.attempt.currentIndex === ${index+1} && !state.busy`);
  }
  assert.equal(await evaluate('state.attempt.score'),0);
  assert.ok(await evaluate("document.querySelector('#result-score-summary').textContent.includes('0/3')"));
  await screenshot('app-results');
  await evaluate('retestIncorrectOnly()');
  assert.equal(await evaluate('state.attempt.total'),3);
  await evaluate('openWrongLogView()');
  assert.equal(await evaluate("document.querySelectorAll('#scroller-wrong-list .question-card').length"),3);
  assert.ok(!(await evaluate("document.querySelector('#scroller-wrong-list').textContent")).includes('undefined'));
  await screenshot('app-wrong-history');
  await evaluate('(async()=>{await refreshHeader(); clearTimeout(toastTimer); document.querySelector("#app-toast").classList.remove("show")})()');
  for (const width of [1440,768,390,320]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<760},sessionId);
    for (const view of ['v-menu','v-list','v-paste','v-quiz','v-wrong','v-pdf','v-settings','v-help','v-edit','v-result']) {
      await evaluate(`setView('${view}')`);
      const overflow = await evaluate('document.documentElement.scrollWidth > window.innerWidth');
      assert.equal(overflow,false,`${view} must fit viewport ${width}px`);
    }
    await evaluate("setView('v-menu'); toggleStudyChat(true)");
    const bounds = await evaluate("(()=>{const r=document.querySelector('#study-chat').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:r.width}})()");
    assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.bottom <= 900);
    assert.ok(bounds.width <= (width<520 ? 310 : 330));
    if (width===390) await screenshot('app-mobile-chat');
    await evaluate('toggleStudyChat(false)');
    if (width===1440) await screenshot('app-desktop');
    if (width===390) await screenshot('app-mobile');
    if (width===390) {
      await evaluate('openLogin()');
      assert.equal(await evaluate('document.documentElement.scrollWidth > window.innerWidth'),false);
      await screenshot('app-mobile-login');
      await evaluate('closeLogin()');
    }
  }
  // The corrected reference uses a paginated table and real bulk/editor mutations.
  await evaluate(`(async()=>{await api('/api/questions/import',post({questions:Array.from({length:42},(_,index)=>({prompt:'Bank pagination fixture '+index,options:['Alpha','Beta','Gamma','Delta'],sourceText:'Test only',confirmed:index%2===0,answerIndex:index%2===0?0:null}))}));await openViewQuestions()})()`);
  assert.equal(await evaluate("document.querySelectorAll('#bankTableBody tr').length"),20);
  assert.equal(await evaluate("document.querySelector('#bankTotal').textContent"),'45');
  const newestId = await evaluate('Math.max(...state.questions.map(question=>question.id))');
  assert.equal(await evaluate("document.querySelector('#bankTableBody .qid').textContent"),'#'+newestId);
  await evaluate('toggleSelectPage(true); setBankPage(2)');
  assert.equal(await evaluate('bankSelected.size'),20);
  assert.equal(await evaluate("document.querySelector('#selectPage').checked"),false);
  await evaluate("document.querySelector('#pageSize').value='50'; changePageSize()");
  assert.equal(await evaluate("document.querySelectorAll('#bankTableBody tr').length"),45);
  assert.equal(await evaluate("document.querySelector('#selectPage').indeterminate"),true);
  await evaluate("bankSelected.clear(); document.querySelector('#bank-filter').value='unconfirmed'; bankFilterChanged()");
  assert.equal(await evaluate("document.querySelectorAll('#bankTableBody tr').length"),21);
  await evaluate("document.querySelector('#bank-filter').value='all'; document.querySelector('#bankSort').value='oldest'; document.querySelector('#pageSize').value='20'; bankFilterChanged()");
  assert.equal(await evaluate("document.querySelector('#bankTableBody .qid').textContent"),'#1');
  await evaluate("document.querySelector('#jumpPage').value='3'; jumpToPage()");
  assert.equal(await evaluate("document.querySelectorAll('#bankTableBody tr').length"),5);
  await evaluate('clearBankSearch(); editQuestion(1)');
  assert.equal(await evaluate("document.querySelector('#editModal').classList.contains('open')"),true);
  await evaluate("document.querySelector('#editQuestion').value+=' updated'; saveEdit()");
  assert.equal(db.prepare('SELECT answer_status FROM questions WHERE id=1').get().answer_status,'unconfirmed');
  assert.equal(db.prepare('SELECT answer_index FROM questions WHERE id=1').get().answer_index,null);
  await evaluate("editQuestion(1); document.querySelector('#editCorrect').value='2'; document.querySelector('#editConfirmed').checked=true; saveEdit()");
  assert.equal(db.prepare('SELECT answer_index FROM questions WHERE id=1').get().answer_index,2);
  const pendingIds = await evaluate("state.questions.filter(question=>question.answerStatus!=='confirmed').slice(0,2).map(question=>question.id)");
  await evaluate(`bankSelected.clear(); bankSelected.add(${pendingIds[0]}); bankSelected.add(${pendingIds[1]}); bankAnswerDrafts.set(${pendingIds[0]},1); window.confirm=()=>false; bulkConfirm()`);
  assert.equal(db.prepare('SELECT answer_status FROM questions WHERE id=?').get(pendingIds[0]).answer_status,'unconfirmed');
  await evaluate('window.confirm=()=>true; bulkConfirm()');
  assert.equal(db.prepare('SELECT answer_index FROM questions WHERE id=?').get(pendingIds[0]).answer_index,1);
  assert.equal(db.prepare('SELECT answer_status FROM questions WHERE id=?').get(pendingIds[1]).answer_status,'unconfirmed');
  assert.equal(await evaluate('bankSelected.size'),1);
  await evaluate('bulkDelete()');
  assert.equal(db.prepare('SELECT id FROM questions WHERE id=?').get(pendingIds[1]),undefined);
  assert.equal(await evaluate('bankSelected.size'),0);
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
  await evaluate("setView('v-list'); clearTimeout(toastTimer); document.querySelector('#app-toast').classList.remove('show')");
  await screenshot('app-question-bank');
  await evaluate('editQuestion(1)');
  await screenshot('app-bank-editor');
  await evaluate('closeEdit()');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true},sessionId);
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false);
  await screenshot('app-mobile-bank');
  process.env.QUIZ_TEACHER_ENABLED = 'false';
  await evaluate('refreshHeader()');
  await evaluate("setView('v-quiz'); toggleStudyChat(true)");
  assert.equal(await evaluate("document.querySelector('#ai-chat-input-field').disabled"),true);
  assert.equal(await evaluate("document.querySelector('#chat-send').disabled"),true);
  assert.ok(await evaluate("document.querySelector('#chat-context').textContent.includes('tạm khóa')"));
  const appBase = `http://127.0.0.1:${server.address().port}`;
  process.env.GOOGLE_CLIENT_ID = 'browser-test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'browser-test-secret';
  process.env.GOOGLE_REDIRECT_URI = appBase+'/auth/google/callback';
  await evaluate("(async()=>{await api('/api/auth/logout',{method:'POST'}); await loadAccount(); toggleStudyChat(false)})()");
  await evaluate("window.savedStartGoogleLogin=startGoogleLogin; window.directGoogleClicks=0; startGoogleLogin=async()=>{window.directGoogleClicks++}; openLogin()");
  assert.equal(await evaluate('window.directGoogleClicks'),1);
  assert.equal(await evaluate("document.querySelector('#loginScreen').classList.contains('open')"),false);
  await evaluate('startGoogleLogin=window.savedStartGoogleLogin');
  const loginStart = await actualFetch(appBase+'/auth/google',{redirect:'manual'});
  const googleState = new URL(loginStart.headers.get('location')).searchParams.get('state');
  await send('Network.setCookie',{name:'quiz_oauth',value:googleState,url:appBase,httpOnly:true,sameSite:'Lax'},sessionId);
  await send('Page.navigate',{url:appBase+'/auth/google/callback?code=browser-test-code&state='+googleState},sessionId);
  await until("document.readyState === 'complete' && typeof authState !== 'undefined' && authState?.user?.id === 'browser-google-user'");
  assert.equal(await evaluate("document.querySelector('#sideName').textContent"),'Browser Test User');
  await evaluate('openLogin()');
  assert.equal(await evaluate("document.querySelector('#account-profile').hidden"),false);
  assert.equal(await evaluate("document.querySelector('#profile-email').textContent"),'browser@example.com');
  assert.equal(await evaluate("document.querySelector('#login-title').textContent"),'Tài khoản của bạn');
  await screenshot('app-account-signed-in');
  await evaluate('window.beforeAccountReload = true');
  await send('Page.reload',{},sessionId);
  await until("document.readyState === 'complete' && !window.beforeAccountReload && typeof authState !== 'undefined' && authState?.user?.id === 'browser-google-user'");
  const questionCountBeforeLogout = db.prepare('SELECT COUNT(*) AS count FROM questions').get().count;
  await evaluate('(async()=>{await openLogin(); await startGoogleLogin()})()');
  assert.equal(await evaluate('authState.user'),null);
  assert.equal(await evaluate("document.querySelector('#sideName').textContent"),'Khách học tập');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM questions').get().count,questionCountBeforeLogout);
  await send('Page.navigate',{url:appBase+'/?auth=cancelled'},sessionId);
  await until("document.readyState === 'complete' && !!document.querySelector('#loginScreen.open') && document.querySelector('#login-feedback').textContent.includes('hủy')");
  assert.equal(await evaluate('authState.user'),null);
  await screenshot('app-login-cancelled');
  await signBrowserIn();
  // External ChatGPT -> real DOCX upload -> automatic preview -> explicit save.
  await evaluate("window.alert=()=>{}; window.confirm=()=>true; closeLogin(); setView('v-paste'); openImportGuide()");
  assert.equal(await evaluate("document.querySelector('#import-guide').open"),true);
  assert.ok(await evaluate("document.querySelector('#word-preparation-prompt').value.includes('Đáp án: C')"));
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedQuizPrompt=text}}}); copyWordPrompt()");
  assert.equal(await evaluate('window.copiedQuizPrompt'),await evaluate('wordPreparationPrompt'));
  await evaluate("navigator.clipboard.writeText=async()=>{throw new Error('clipboard unavailable')}; copyWordPrompt()");
  assert.equal(await evaluate("document.querySelector('#word-preparation-prompt').selectionEnd"),(await evaluate('wordPreparationPrompt')).length);
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
  await screenshot('app-word-import-guide');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true},sessionId);
  assert.equal(await evaluate("document.querySelector('#import-guide').scrollWidth > document.querySelector('#import-guide').clientWidth"),false);
  await screenshot('app-mobile-word-import-guide');
  const fixture = require('./document-fixtures');
  const preparedText = 'Câu 1: Thủ đô của Việt Nam là thành phố nào?\nA. Thành phố Hồ Chí Minh\nB. Đà Nẵng\nC. Hà Nội\nD. Hải Phòng\nĐáp án: C';
  const preparedWord = await fixture.docx(preparedText);
  const bankBeforeWord = db.prepare('SELECT COUNT(*) AS count FROM questions').get().count;
  await evaluate(`uploadPreparedWord({target:{files:[new File([new Uint8Array(${JSON.stringify([...preparedWord])})],'chatgpt-prepared.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})],value:''}})`);
  assert.equal(await evaluate("document.querySelector('#import-guide').open"),false);
  assert.equal(await evaluate('state.pending.length'),1);
  assert.equal(await evaluate('state.pending[0].answerIndex'),2);
  assert.equal(await evaluate("document.querySelector('[data-answer]').value"),'2');
  assert.equal(await evaluate("document.querySelector('#import-preview').hidden"),false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM questions').get().count,bankBeforeWord);
  await screenshot('app-prepared-word-preview');
  await evaluate('saveImportPreview()');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM questions').get().count,bankBeforeWord+1);
  const lastWord = db.prepare('SELECT prompt,answer_index FROM questions ORDER BY id DESC LIMIT 1').get();
  assert.equal(lastWord.prompt,'Thủ đô của Việt Nam là thành phố nào?');
  assert.equal(lastWord.answer_index,2);
  const invalidWord = await fixture.docx('Tài liệu chưa được chuẩn hóa.');
  await evaluate(`processLocalFileParsing({target:{files:[new File([new Uint8Array(${JSON.stringify([...invalidWord])})],'unprocessed.docx')]}})`);
  assert.equal(await evaluate('state.pending.length'),0);
  assert.ok(await evaluate("document.querySelector('#import-message').textContent.includes('chưa tìm thấy câu hỏi')"));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM questions').get().count,bankBeforeWord+1);
  const originalPreparationPrompt = await evaluate('wordPreparationPrompt');
  await evaluate('openTextbookGuide()');
  assert.equal(await evaluate("document.querySelector('#textbook-guide').open"),true);
  assert.ok(await evaluate("document.querySelector('#textbook-preparation-prompt').value.includes('20 câu mỗi chương')"));
  assert.ok(await evaluate("document.querySelector('#textbook-preparation-prompt').value.includes('Chuong_01_Ten_chuong.docx')"));
  await evaluate('navigator.clipboard.writeText=async text=>{window.copiedTextbookPrompt=text}; copyTextbookPrompt()');
  assert.equal(await evaluate('window.copiedTextbookPrompt'),await evaluate('textbookPreparationPrompt'));
  assert.notEqual(await evaluate('window.copiedTextbookPrompt'),originalPreparationPrompt);
  await screenshot('app-textbook-guide-mobile');
  assert.equal(await evaluate("document.querySelector('#textbook-guide').scrollWidth > document.querySelector('#textbook-guide').clientWidth"),false);
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
  await screenshot('app-textbook-guide-desktop');
  await evaluate("document.querySelector('#textbook-guide').close(); openImportGuide()");
  assert.equal(await evaluate("document.querySelector('#word-preparation-prompt').value"),originalPreparationPrompt);
  await evaluate('copyWordPrompt()');
  assert.equal(await evaluate('window.copiedTextbookPrompt'),originalPreparationPrompt);
  await evaluate("document.querySelector('#import-guide').close(); openTextbookGuide()");
  const chapterBefore = db.prepare('SELECT COUNT(*) AS count FROM questions').get().count;
  await evaluate(`uploadChapterWord({target:{files:[new File([new Uint8Array(${JSON.stringify([...preparedWord])})],'Chuong_01_Ten_chuong.docx')],value:''}})`);
  assert.equal(await evaluate("document.querySelector('#textbook-guide').open"),false);
  assert.equal(await evaluate('state.pending.length'),1);
  assert.equal(await evaluate('state.pending[0].answerIndex'),2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM questions').get().count,chapterBefore);
  await evaluate('saveImportPreview()');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM questions').get().count,chapterBefore+1);
  // A slow save must show selection immediately, never an invented grade.
  await evaluate("(async()=>{const saved=await api('/api/questions/import',post({questions:['Fast one','Fast two'].map(prompt=>({prompt,options:['a','b','c','d'],answerIndex:1,confirmed:true}))}));state.attempt=await api('/api/attempts',post({questionIds:saved.imported.map(q=>q.id)}));state.teacherEnabled=false;await showQuiz();window.quizFetch=window.fetch;window.answerSends=0;window.chatReads=0;window.submitSends=0;window.fetch=(url,options)=>{if(String(url).endsWith('/chat'))window.chatReads++;if(String(url).endsWith('/submit'))window.submitSends++;if(String(url).endsWith('/answer')){window.answerSends++;return new Promise(resolve=>setTimeout(resolve,180)).then(()=>window.quizFetch(url,options));}return window.quizFetch(url,options);};window.pickTask=chooseAnswer(1).then(()=>{window.feedbackShown=!!document.querySelector('.option-item.correct')});window.immediatePick={pending:!!document.querySelector('.option-item.pending'),graded:!!document.querySelector('.option-item.correct,.option-item.wrong'),disabled:[...document.querySelectorAll('.option-item')].every(button=>button.disabled)};})()");
  assert.deepEqual(await evaluate('window.immediatePick'),{pending:true,graded:false,disabled:true});
  await evaluate('window.pickTask');
  assert.equal(await evaluate('window.feedbackShown'),true);
  await until('state.attempt.currentIndex===1 && !state.busy');
  assert.equal(await evaluate('window.answerSends'),1);
  assert.equal(await evaluate('window.chatReads'),0);
  const fastAttempt=await evaluate('state.attempt.id');
  assert.equal(db.prepare('SELECT current_index FROM attempts WHERE id=?').get(fastAttempt).current_index,1);
  await evaluate("window.fetch=(url,options)=>String(url).endsWith('/answer')?Promise.reject(new Error('Test offline')):window.quizFetch(url,options);chooseAnswer(0)");
  assert.equal(await evaluate('currentQuestion().selectedIndex'),null);
  assert.equal(await evaluate('Boolean(state.answerPending)||state.busy'),false);
  assert.equal(await evaluate("!!document.querySelector('.option-item.correct,.option-item.wrong,.option-item.pending')"),false);
  await evaluate("window.fetch=(url,options)=>{if(String(url).endsWith('/submit'))window.submitSends++;return window.quizFetch(url,options)};chooseAnswer(1)");
  await evaluate('Promise.all([finishQuiz(),finishQuiz()])');
  assert.equal(await evaluate('window.submitSends'),1);
  assert.equal(await evaluate('state.attempt.score'),2);
  assert.equal(await evaluate('state.view'),'v-result');
  await evaluate('window.fetch=window.quizFetch');
  await evaluate("renderImportPreview({questions:Array.from({length:5000},(_,i)=>({id:'large-'+i,prompt:'Preview '+i,options:['A','B','C','D'],answerIndex:2,answerStatus:'confirmed'}))})");
  assert.equal(await evaluate("document.querySelectorAll('#import-preview .preview-question').length"),25);
  await evaluate("document.querySelector('[data-prompt]').value='Edited first';document.querySelector('[data-prompt]').dispatchEvent(new Event('input'));changeImportPreviewPage(2)");
  assert.equal(await evaluate('state.pending[0].prompt'),'Edited first');
  assert.equal(await evaluate('state.pending[0].confirmed'),false);
  await evaluate("document.querySelector('[data-answer]').value='1';document.querySelector('[data-answer]').dispatchEvent(new Event('change'));changeImportPreviewPage(3);changeImportPreviewPage(2)");
  assert.equal(await evaluate("document.querySelector('[data-answer]').value"),'1');
  assert.equal(await evaluate('collectPreview().length'),5000);
  assert.deepEqual(exceptions, []);
});
