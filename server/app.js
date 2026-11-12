const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
if (require.main === module) {
  try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const db = require('./database');
const { parseQuizText } = require('./parser');
const { validAnswer, suggestAnswers } = require('./ai-suggestions');
const { generateGemini } = require('./gemini');
const { ownerId, requireAccount } = require('./ownership');

const app = express();
app.disable('x-powered-by');
app.use(require('./security'));
const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, '..', 'public');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.get('/healthz', async (_req,res) => {
  try { (await db.prepare('SELECT 1').get()); res.json({status:'ok'}); }
  catch { res.status(503).json({status:'unavailable'}); }
});
app.use(express.json({ limit: '10mb' }));
app.use(require('./google-auth').createGoogleAuth());
app.use('/api', (req,res,next) => {
  if (['/ai/status','/integrations/pdf'].includes(req.path)) return next();
  return requireAccount(req,res,next);
});
app.get('/index.html', (_req, res) => res.redirect('/'));
app.use(express.static(publicDirectory, { index: false }));
app.get('/', (_req, res) => res.sendFile(path.join(publicDirectory, 'reference.html')));
function pdfChatbotUrl() {
  try {
    const url = new URL(process.env.CHATBOT_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (['localhost', '127.0.0.1'].includes(url.hostname) && Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === port) return null;
    return url.href;
  } catch { return null; }
}
app.get('/api/integrations/pdf', (_req, res) => res.json({ configured: Boolean(pdfChatbotUrl()) }));
app.get('/pdf-chatbot', (_req, res) => {
  const url = pdfChatbotUrl();
  if (!url) return res.status(503).type('text').send('Trợ lý PDF chưa có địa chỉ riêng. Cấu hình CHATBOT_URL tới ứng dụng PDF đang chạy ở cổng khác rồi khởi động lại PRO QUIZ.');
  res.redirect(url);
});

function aiConfig() {
  const nativeUrl = process.env.GEMINI_API_URL?.trim() || (process.env.OPENAI_API_URL?.includes(':generateContent') ? process.env.OPENAI_API_URL.trim() : '');
  if (process.env.GEMINI_API_KEY?.trim() || nativeUrl) {
    const key = process.env.GEMINI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
    const model = process.env.GEMINI_MODEL?.trim() || nativeUrl.match(/\/models\/([^/:?]+):generateContent/)?.[1] || 'gemini-3.5-flash-lite';
    if (key) return { provider: 'Gemini', key, model, url: nativeUrl || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` };
    return null;
  }
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) return { provider: 'OpenAI', key, model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini' };
  return null;
}

let lastAIConnectionAt = null;
async function generateAI(messages, { jsonMode = false, maxTokens = 500 } = {}) {
  const config = aiConfig();
  if (!config) throw new Error('Chưa kết nối AI: hãy cấu hình GEMINI_API_KEY hoặc OPENAI_API_KEY trong .env rồi khởi động lại server.');
  if (config.provider === 'Gemini') {
    const text = await generateGemini(config, messages, { jsonMode, maxTokens });
    lastAIConnectionAt = new Date().toISOString();
    return text;
  }
  let response;
  try {
    response = await fetch(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` }, body: JSON.stringify({ model: config.model, messages, ...(jsonMode && { response_format: { type: 'json_object' } }), max_completion_tokens: maxTokens, store: false }) });
  } catch (error) {
    // Do not return raw network/provider errors: they can contain request details.
    throw new Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'OpenAI quá thời gian phản hồi. Hãy thử lại.' : 'Không thể kết nối OpenAI. Kiểm tra mạng của backend rồi thử lại.');
  }
  if (!response.ok) {
    const reasons = { 400: 'Kiểm tra OPENAI_MODEL và định dạng yêu cầu.', 401: 'OPENAI_API_KEY không hợp lệ.', 403: 'Khóa không có quyền truy cập model/project.', 404: 'Không tìm thấy model hoặc endpoint.', 429: 'Đã hết hạn mức hoặc bị giới hạn tần suất. Kiểm tra tài khoản OpenAI.' };
    throw new Error(`OpenAI trả HTTP ${response.status}. ${reasons[response.status] || 'Dịch vụ chưa sẵn sàng. Hãy thử lại sau.'}`);
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('OpenAI trả phản hồi không hợp lệ. Hãy thử lại.'); }
  const choice = data?.choices?.[0];
  if (choice?.message?.refusal) throw new Error('OpenAI không thể xử lý nội dung này. Hãy kiểm tra lại đề.');
  if (choice?.finish_reason === 'length') throw new Error('Phản hồi OpenAI bị cắt do giới hạn token. Hãy chia nhỏ đề hoặc chọn model phù hợp.');
  const text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
  if (!text) throw new Error('OpenAI trả nội dung rỗng. Hãy kiểm tra model và thử lại.');
  lastAIConnectionAt = new Date().toISOString();
  return text;
}

function json(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function answerLabel(index) {
  return index === null || index === undefined ? 'CHƯA XÁC NHẬN' : String.fromCharCode(65 + Number(index));
}

function mapQuestion(row, options = []) {
  return {
    id: row.id,
    prompt: row.prompt,
    sourceText: row.source_text,
    setId: row.set_id,
    options,
    answerIndex: row.answer_index,
    answerStatus: row.answer_status,
    answerSource: row.answer_source,
    aiSuggestionIndex: row.ai_suggestion_index,
    aiSuggestionReason: row.ai_suggestion_reason
  };
}

async function getQuestions(ids = null) {
  const groups = ids === null ? [null] : Array.from({length:Math.ceil(ids.length/2000)},(_,index)=>ids.slice(index*2000,index*2000+2000));
  const result = new Map();
  for (const group of groups) {
    const rows = await db.prepare('SELECT q.*, o.option_index, o.text AS option_text FROM questions q LEFT JOIN options o ON o.question_id=q.id WHERE q.owner_id=?'+(group ? ' AND q.id IN ('+group.map(()=>'?').join(',')+')' : '')+' ORDER BY q.id,o.option_index').all(ownerId(),...(group || []));
    for (const row of rows) {
      if (!result.has(row.id)) result.set(row.id,mapQuestion(row,[]));
      if (row.option_index !== null) result.get(row.id).options[row.option_index]=row.option_text;
    }
  }
  return [...result.values()];
}
async function getQuestion(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id)<1) return null;
  return (await getQuestions([Number(id)]))[0] || null;
}

async function getStats() {
  const row = (await db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN answer_status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed, SUM(CASE WHEN answer_status != 'confirmed' THEN 1 ELSE 0 END) AS unconfirmed FROM questions WHERE owner_id = ?`).get(ownerId()));
  const wrongCount = new Set((await getWrongAnswers()).map(question => question.id)).size;
  const active = (await db.prepare("SELECT id FROM attempts WHERE status = 'in_progress' AND owner_id = ? ORDER BY updated_at DESC LIMIT 1").get(ownerId()));
  return { total: Number(row.total || 0), confirmed: Number(row.confirmed || 0), unconfirmed: Number(row.unconfirmed || 0), wrong: wrongCount, activeAttemptId: active?.id || null };
}

async function getWrongAnswers() {
  const entries = (await db.prepare("SELECT w.question_id, w.selected_index, w.attempt_id, w.created_at FROM wrong_answers w JOIN attempts a ON a.id=w.attempt_id WHERE a.status='completed' AND a.owner_id=? ORDER BY w.id DESC").all(ownerId())).map(row=>({id:row.question_id,selectedIndex:row.selected_index,attemptId:row.attempt_id,wrongAt:row.created_at,attemptStatus:'completed'}));
  const active = await db.prepare("SELECT id,question_order,answers,updated_at FROM attempts WHERE status='in_progress' AND owner_id=? ORDER BY updated_at DESC,id DESC").all(ownerId());
  const pending=[];
  for (const attempt of active) {
    const answers=json(attempt.answers,{});
    for (const id of json(attempt.question_order,[])) if (validAnswer(answers[id])) pending.push({id,selectedIndex:answers[id],attemptId:attempt.id,wrongAt:attempt.updated_at,attemptStatus:'in_progress'});
  }
  const questions=new Map((await getQuestions([...new Set([...entries,...pending].map(entry=>entry.id))])).map(question=>[question.id,question]));
  for (const entry of pending) {
    const question=questions.get(entry.id);
    if (question?.answerStatus==='confirmed' && validAnswer(question.answerIndex) && entry.selectedIndex!==question.answerIndex) entries.push(entry);
  }
  return entries.filter(entry=>questions.has(entry.id)).map(entry=>({...questions.get(entry.id),...entry})).sort((a,b)=>b.wrongAt.localeCompare(a.wrongAt)||b.attemptId-a.attemptId);
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

async function getAttempt(id, includeAnswer = false, visibleIds = null) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) return null;
  const attempt = (await db.prepare('SELECT * FROM attempts WHERE id = ? AND owner_id = ?').get(Number(id), ownerId()));
  if (!attempt) return null;
  const questionOrder = json(attempt.question_order, []);
  const optionOrders = json(attempt.option_orders, {});
  const answers = json(attempt.answers, {});
  const storedQuestions = new Map((await getQuestions(visibleIds || questionOrder)).map(question=>[question.id,question]));
  const questions = questionOrder.filter(questionId=>!visibleIds || visibleIds.includes(questionId)).map(questionId => {
    const question = storedQuestions.get(questionId);
    if (!question) return null;
    const order = optionOrders[questionId] || [0, 1, 2, 3];
    const revealAnswer = includeAnswer && (attempt.status === 'completed' || validAnswer(answers[questionId]));
    return { id: question.id, prompt: question.prompt, options: order.map((optionIndex) => ({ index: optionIndex, text: question.options[optionIndex] })), selectedIndex: answers[questionId] ?? null, answerStatus: question.answerStatus, ...(revealAnswer && { answerIndex: question.answerIndex }) };
  }).filter(Boolean);
  return { ...(visibleIds && {partial:true}), id: attempt.id, status: attempt.status, currentIndex: attempt.current_index, score: attempt.score, total: visibleIds ? questionOrder.length : questions.length, questions, updatedAt: attempt.updated_at };
}

app.get('/api/stats', async (_req, res) => res.json((await getStats())));
app.get('/api/dashboard', async (_req, res) => {
  const completed = (await db.prepare("SELECT question_order, score FROM attempts WHERE status = 'completed' AND owner_id = ?").all(ownerId()));
  const total = completed.reduce((sum, attempt) => sum + json(attempt.question_order, []).length, 0);
  const correct = completed.reduce((sum, attempt) => sum + attempt.score, 0);
  const recent = (await db.prepare('SELECT id, status, question_order, answers, score, updated_at FROM attempts WHERE owner_id = ? ORDER BY updated_at DESC, id DESC LIMIT 3').all(ownerId())).map(attempt => {
    const ids = json(attempt.question_order, []);
    const answers = json(attempt.answers, {});
    return { id: attempt.id, status: attempt.status, total: ids.length, answered: ids.filter(id => answers[id] !== undefined && answers[id] !== null).length, score: attempt.score, updatedAt: attempt.updated_at };
  });
  res.json({ ...(await getStats()), completedAttempts: completed.length, accuracy: total ? Math.round(correct * 100 / total) : null, recent });
});
app.get('/api/ai/status', (_req, res) => {
  const config = aiConfig();
  res.json({ configured: Boolean(config), teacherEnabled: process.env.QUIZ_TEACHER_ENABLED === 'true', provider: config?.provider || 'AI', model: config?.model || null, connectionVerified: Boolean(config && lastAIConnectionAt), lastSuccessfulRequestAt: config ? lastAIConnectionAt : null });
});

app.post('/api/imports/preview', async (req, res) => {
  const parsed = parseQuizText(req.body.text);
  parsed.questions = parsed.questions.map((question) => ({ ...question, id: randomUUID() }));
  res.json({ ...parsed, aiAvailable: Boolean(aiConfig()), aiMessage: aiConfig() ? null : 'Chưa kết nối AI. Câu có đáp án nguồn vẫn được nhận diện chính xác.' });
});

app.post('/api/imports/file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn tệp đề.' });
  const extension = path.extname(req.file.originalname).toLowerCase();
  try {
    let text;
    if (extension === '.txt') text = req.file.buffer.toString('utf8');
    else if (extension === '.docx') text = (await mammoth.extractRawText({ buffer: req.file.buffer })).value;
    else if (extension === '.pdf') {
      const parser = new PDFParse({ data: req.file.buffer });
      text = (await parser.getText()).text;
      await parser.destroy();
    } else return res.status(415).json({ error: 'Chỉ hỗ trợ TXT, DOCX và PDF có văn bản.' });
    if (!text.trim()) return res.status(422).json({ error: 'Không tìm thấy văn bản trong tệp.' });
    res.json({ text, fileName: req.file.originalname });
  } catch (error) {
    res.status(422).json({ error: `Không thể đọc tệp: ${error.message}` });
  }
});

app.post('/api/imports/ai-preview', async (req, res) => {
  const parsed = Array.isArray(req.body.questions)
    ? { questions: req.body.questions, invalid: [], totalBlocks: req.body.questions.length }
    : parseQuizText(req.body.text);
  if (!parsed.questions.length) return res.status(400).json({ error: 'Không tìm thấy câu hỏi có đủ A–D.', invalid: parsed.invalid });
  if (parsed.questions.length > 100) return res.status(400).json({ error: 'Mỗi lần phân tích tối đa 100 câu. Hãy chia nhỏ đề.' });
  if (parsed.questions.some((question) => !question || typeof question !== 'object')) return res.status(400).json({ error: 'Dữ liệu câu hỏi không hợp lệ.' });
  const questions = parsed.questions.map((question) => ({ ...question, id: question.id || randomUUID() }));
  if (questions.some((question) => typeof question.id !== 'string' || question.id.length > 100 || typeof question.prompt !== 'string' || !question.prompt.trim() || !Array.isArray(question.options) || question.options.length !== 4 || question.options.some((option) => typeof option !== 'string' || !option.trim())) || new Set(questions.map((question) => question.id)).size !== questions.length) {
    return res.status(400).json({ error: 'Câu hỏi phải có ID riêng, nội dung và đủ bốn lựa chọn A–D.' });
  }
  if (!aiConfig()) return res.status(503).json({ error: 'Chưa kết nối AI. Bạn vẫn có thể xem trước, chọn đáp án và xác nhận thủ công.', ...parsed, questions });
  try {
    const suggested = await suggestAnswers(questions.filter((question) => question.answerSource !== 'source' || !validAnswer(question.answerIndex)), generateAI);
    const byId = new Map(suggested.map((question) => [question.id, question]));
    res.json({ ...parsed, questions: questions.map((question) => byId.get(question.id) || question), aiMessage: 'AI đề xuất — chưa xác nhận. Đọc giải thích, sửa nếu cần và xác nhận từng câu trước khi chấm điểm.' });
  } catch (error) {
    res.status(502).json({ error: error.message || 'AI trả về dữ liệu không hợp lệ. Hãy thử lại.' });
  }
});

app.post('/api/questions/import', async (req, res) => {
  const parsed = Array.isArray(req.body.questions)
    ? { questions: req.body.questions, invalid: [], totalBlocks: req.body.questions.length }
    : parseQuizText(req.body.text);
  const imported = [];
  const validated = [];
  for (const question of parsed.questions) {
    if (!question || typeof question !== 'object') return res.status(400).json({ error: 'Dữ liệu câu hỏi không hợp lệ.' });
    const prompt = typeof question.prompt === 'string' ? question.prompt.trim() : '';
    const options = Array.isArray(question.options) ? question.options.map((option) => String(option || '').trim()) : [];
    const candidate = question.answerIndex;
    const hasAnswer = candidate !== null && candidate !== undefined && candidate !== '';
    if (!prompt || options.length !== 4 || options.some((option) => !option) || (hasAnswer && !validAnswer(candidate))) return res.status(400).json({ error: 'Có câu không hợp lệ. Nội dung xem trước chưa được lưu; hãy kiểm tra câu và bốn lựa chọn.' });
    const fromAI = question.answerSource === 'ai_suggestion' || question.aiSuggestionIndex != null || Boolean(question.aiSuggestionReason);
    const explicitlyConfirmed = question.confirmed === true;
    const answerIndex = hasAnswer && (explicitlyConfirmed || (!fromAI && question.answerSource === 'source')) ? candidate : null;
    const answerStatus = answerIndex === null ? 'unconfirmed' : 'confirmed';
    const answerSource = answerIndex === null ? (fromAI ? 'ai_suggestion' : 'not_provided') : (explicitlyConfirmed ? 'user' : 'source');
    const sourceText = typeof question.sourceText === 'string' && question.sourceText.trim() ? question.sourceText.trim() : prompt;
    const suggestionIndex = validAnswer(question.aiSuggestionIndex) ? question.aiSuggestionIndex : null;
    const suggestionReason = typeof question.aiSuggestionReason === 'string' ? question.aiSuggestionReason.trim().slice(0, 6000) : null;
    validated.push({ prompt, options, answerIndex, answerStatus, answerSource, sourceText, suggestionIndex, suggestionReason });
  }
  if (!validated.length) return res.status(400).json({ error: 'Không có câu hợp lệ để lưu.' });
  await db.transaction(async () => {
    for (let offset=0;offset<validated.length;offset+=500) {
      const chunk=validated.slice(offset,offset+500);
      const ids=(await db.prepare('INSERT INTO questions (prompt,source_text,answer_index,answer_status,answer_source,ai_suggestion_index,ai_suggestion_reason,owner_id) VALUES '+chunk.map(()=>'(?,?,?,?,?,?,?,?)').join(',')+' RETURNING id').all(...chunk.flatMap(question=>[question.prompt,question.sourceText,question.answerIndex,question.answerStatus,question.answerSource,question.suggestionIndex,question.suggestionReason,ownerId()]))).map(row=>row.id).sort((a,b)=>a-b);
      await db.prepare('INSERT INTO options (question_id,option_index,text) VALUES '+chunk.flatMap(()=>Array(4).fill('(?,?,?)')).join(',')).run(...chunk.flatMap((question,index)=>question.options.flatMap((text,optionIndex)=>[ids[index],optionIndex,text])));
      chunk.forEach((question,index)=>imported.push(mapQuestion({id:ids[index],prompt:question.prompt,source_text:question.sourceText,set_id:null,answer_index:question.answerIndex,answer_status:question.answerStatus,answer_source:question.answerSource,ai_suggestion_index:question.suggestionIndex,ai_suggestion_reason:question.suggestionReason},question.options)));
    }
  });
  res.status(201).json({ ...parsed, imported });
});

app.use('/api/question-sets', require('./question-sets'));

app.get('/api/questions', async (_req, res) => {
  res.json(await getQuestions());
});

app.get('/api/questions/:id', async (req, res, next) => {
  if (req.params.id === 'export') return next();
  const question = (await getQuestion(req.params.id));
  if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi.' });
  res.json(question);
});

app.patch('/api/questions/:id', async (req, res) => {
  const question = (await getQuestion(req.params.id));
  if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi.' });
  const answerIndex = req.body.answerIndex;
  const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : question.prompt;
  const options = Array.isArray(req.body.options) ? req.body.options.map((option) => String(option || '').trim()) : question.options;
  if (!validAnswer(answerIndex)) return res.status(400).json({ error: 'Đáp án phải là A, B, C hoặc D.' });
  if (!prompt || options.length !== 4 || options.some((option) => !option)) return res.status(400).json({ error: 'Câu hỏi cần nội dung và đủ bốn lựa chọn.' });
  await db.transaction(async () => {
  const updateQuestion = db.prepare("UPDATE questions SET prompt = ?, answer_index = ?, answer_status = 'confirmed', answer_source = 'user', updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  (await updateQuestion.run(prompt, answerIndex, question.id));
  (await db.prepare('DELETE FROM options WHERE question_id = ?').run(question.id));
  const insertOption = db.prepare('INSERT INTO options (question_id, option_index, text) VALUES (?, ?, ?)');
  (await Promise.all(options.map(async (text, optionIndex) => (await insertOption.run(question.id, optionIndex, text)))));
  });
  res.json((await getQuestion(question.id)));
});

app.patch('/api/questions/:id/content', async (req, res) => {
  const question = (await getQuestion(req.params.id));
  if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi.' });
  const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';
  const options = Array.isArray(req.body.options) ? req.body.options.map((option) => String(option || '').trim()) : [];
  if (!prompt || options.length !== 4 || options.some((option) => !option)) return res.status(400).json({ error: 'Câu hỏi cần nội dung và đủ bốn lựa chọn.' });
  await db.transaction(async () => {
  (await db.prepare("UPDATE questions SET prompt = ?, answer_index = NULL, answer_status = 'unconfirmed', answer_source = 'not_provided', ai_suggestion_index = NULL, ai_suggestion_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(prompt, question.id));
  (await db.prepare('DELETE FROM options WHERE question_id = ?').run(question.id));
  const insertOption = db.prepare('INSERT INTO options (question_id, option_index, text) VALUES (?, ?, ?)');
  (await Promise.all(options.map(async (text, optionIndex) => (await insertOption.run(question.id, optionIndex, text)))));
  });
  res.json((await getQuestion(question.id)));
});

app.post('/api/questions/:id/ai-suggest', async (req, res) => {
  const question = (await getQuestion(req.params.id));
  if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi.' });
  if (!aiConfig()) return res.status(503).json({ error: 'Chưa kết nối AI: hãy cấu hình GEMINI_API_KEY hoặc OPENAI_API_KEY trong .env rồi khởi động lại server.' });

  try {
    const [suggestion] = await suggestAnswers([{ ...question, id: String(question.id) }], generateAI);
    const current = (await getQuestion(question.id));
    if (!current || current.prompt !== question.prompt || JSON.stringify(current.options) !== JSON.stringify(question.options)) return res.status(409).json({ error: 'Câu hỏi đã thay đổi trong khi AI phân tích. Hãy thử lại.' });
    (await db.prepare("UPDATE questions SET ai_suggestion_index = ?, ai_suggestion_reason = ?, answer_source = CASE WHEN answer_status = 'confirmed' THEN answer_source ELSE 'ai_suggestion' END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(suggestion.aiSuggestionIndex, suggestion.aiSuggestionReason, question.id));
    res.json({ ...(await getQuestion(question.id)), needsReview: suggestion.needsReview });
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.delete('/api/questions/all', async (_req, res) => {
  await db.transaction(async () => {
    (await db.prepare('DELETE FROM attempts WHERE owner_id = ?').run(ownerId()));
    (await db.prepare('DELETE FROM questions WHERE owner_id = ?').run(ownerId()));
  });
  res.status(204).end();
});

app.delete('/api/progress', async (_req, res) => {
  (await db.prepare("DELETE FROM attempts WHERE status = 'in_progress' AND owner_id = ?").run(ownerId()));
  res.status(204).end();
});

app.delete('/api/questions/:id', async (req, res) => {
  const result = (await db.prepare('DELETE FROM questions WHERE id = ? AND owner_id = ?').run(Number(req.params.id), ownerId()));
  if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy câu hỏi.' });
  res.status(204).end();
});

app.get('/api/questions/export', async (_req, res) => {
  const questions = await getQuestions();
  const text = questions.map((question, index) => {
    const options = question.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`).join('\n');
    const answer = question.answerIndex === null ? 'CHƯA XÁC NHẬN' : String.fromCharCode(65 + question.answerIndex);
    return `${index + 1}. ${question.prompt}\n${options}\nĐáp án: ${answer}`;
  }).join('\n\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pro-quiz-bank.txt"');
  res.send(text);
});

app.get('/api/wrong-answers/export', async (_req, res) => {
  const rows = (await getWrongAnswers());
  const text = rows.map((question, index) => {
    const options = question.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`).join('\n');
    return `Lượt ${question.attemptId} · Câu ${index + 1}: ${question.prompt}\n${options}\nBạn chọn: ${answerLabel(question.selectedIndex)} · Đáp án đúng: ${answerLabel(question.answerIndex)}`;
  }).join('\n\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pro-quiz-wrong-history.txt"');
  res.send(text);
});

app.get('/api/wrong-answers', async (_req, res) => {
  res.json((await getWrongAnswers()));
});

app.post('/api/attempts', async (req, res) => {
  const requestedIds = Array.isArray(req.body.questionIds) ? req.body.questionIds.map(Number).filter(Number.isInteger) : null;
  if (requestedIds && !requestedIds.length) return res.status(400).json({error:'Chưa chọn câu hỏi để luyện tập.'});
  const rows = requestedIds ? (await db.prepare(`SELECT id FROM questions WHERE owner_id = ? AND answer_status = 'confirmed' AND id IN (${requestedIds.map(() => '?').join(',')}) ORDER BY id`).all(ownerId(), ...requestedIds)) : (await db.prepare("SELECT id FROM questions WHERE answer_status = 'confirmed' AND owner_id = ? ORDER BY id").all(ownerId()));
  if (requestedIds && rows.length !== new Set(requestedIds).size) return res.status(400).json({ error: 'Danh sách câu hỏi không hợp lệ hoặc không thuộc tài khoản của bạn.' });
  if (rows.length === 0) return res.status(400).json({ error: 'Cần ít nhất một câu đã xác nhận đáp án để bắt đầu test.' });
  const questionOrder = shuffle(rows.map((row) => row.id));
  const optionOrders = {};
  questionOrder.forEach((questionId) => { optionOrders[questionId] = shuffle([0, 1, 2, 3]); });
  const result = (await db.prepare('INSERT INTO attempts (question_order, option_orders, owner_id) VALUES (?, ?, ?)').run(JSON.stringify(questionOrder), JSON.stringify(optionOrders), ownerId()));
  res.status(201).json((await getAttempt(result.lastInsertRowid, true)));
});

app.get('/api/attempts/active', async (_req, res) => {
  const row = (await db.prepare("SELECT id FROM attempts WHERE status = 'in_progress' AND owner_id = ? ORDER BY updated_at DESC LIMIT 1").get(ownerId()));
  res.json(row ? (await getAttempt(row.id, true)) : null);
});

app.get('/api/attempts/:id', async (req, res) => {
  const attempt = (await getAttempt(req.params.id, true));
  if (!attempt) return res.status(404).json({ error: 'Không tìm thấy lượt làm bài.' });
  res.json(attempt);
});

app.patch('/api/attempts/:id/answer', async (req, res) => {
  const attempt = (await db.prepare("SELECT * FROM attempts WHERE id = ? AND status = 'in_progress' AND owner_id = ?").get(Number(req.params.id), ownerId()));
  if (!attempt) return res.status(404).json({ error: 'Lượt làm bài không tồn tại hoặc đã kết thúc.' });
  const questionId = Number(req.body.questionId);
  const selectedIndex = req.body.selectedIndex === null ? null : Number(req.body.selectedIndex);
  const questionOrder = json(attempt.question_order, []);
  if (!questionOrder.includes(questionId) || (selectedIndex !== null && (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 3))) return res.status(400).json({ error: 'Lựa chọn không hợp lệ.' });
  const answers = json(attempt.answers, {});
  answers[questionId] = selectedIndex;
  const currentIndex = Math.max(0, Math.min(questionOrder.length - 1, Number(req.body.currentIndex) || 0));
  (await db.prepare('UPDATE attempts SET answers = ?, current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(answers), currentIndex, attempt.id));
  res.json(await getAttempt(attempt.id,true,req.body.compact === true ? [...new Set([questionId,questionOrder[currentIndex]])] : null));
});

app.post('/api/attempts/:id/submit', async (req, res) => {
  const attempt = (await db.prepare("SELECT * FROM attempts WHERE id = ? AND status = 'in_progress' AND owner_id = ?").get(Number(req.params.id), ownerId()));
  if (!attempt) return res.status(404).json({ error: 'Lượt làm bài không tồn tại hoặc đã kết thúc.' });
  const answers = json(attempt.answers, {});
  const questionOrder = json(attempt.question_order, []);
  let score = 0;
  const wrong = [];
  const storedQuestions=new Map((await getQuestions(questionOrder)).map(question=>[question.id,question]));
  questionOrder.forEach(questionId => {
    const question = storedQuestions.get(questionId);
    if (!question || question.answerStatus !== 'confirmed' || !validAnswer(question.answerIndex)) return;
    if (answers[questionId] !== undefined && answers[questionId] === question.answerIndex) score += 1;
    else wrong.push({ questionId, selectedIndex: answers[questionId] ?? null });
  });
  await db.transaction(async () => {
  (await db.prepare("UPDATE attempts SET status = 'completed', score = ?, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(score, attempt.id));
  for (let offset=0;offset<wrong.length;offset+=1000) {
    const chunk=wrong.slice(offset,offset+1000);
    await db.prepare('INSERT OR REPLACE INTO wrong_answers (attempt_id,question_id,selected_index) VALUES '+chunk.map(()=>'(?,?,?)').join(',')).run(...chunk.flatMap(item=>[attempt.id,item.questionId,item.selectedIndex]));
  }
  });
  res.json({ ...(await getAttempt(attempt.id, true)), score, wrongCount: wrong.length });
});

app.post('/api/attempts/:id/retry-wrong', async (req, res) => {
  const attemptId = Number(req.params.id);
  if (!(await db.prepare('SELECT id FROM attempts WHERE id = ? AND owner_id = ?').get(attemptId, ownerId()))) return res.status(404).json({ error: 'Không tìm thấy lượt làm bài.' });
  const ids = [...new Set((await getWrongAnswers()).filter(question => question.attemptId === attemptId && question.answerStatus === 'confirmed' && validAnswer(question.answerIndex)).map(question => question.id))];
  if (!ids.length) return res.status(400).json({ error: 'Lượt này chưa có câu đã trả lời sai và còn đáp án xác nhận để ôn.' });
  const questionOrder = shuffle(ids);
  const optionOrders = {};
  questionOrder.forEach((questionId) => { optionOrders[questionId] = shuffle([0, 1, 2, 3]); });
  const result = (await db.prepare('INSERT INTO attempts (question_order, option_orders, owner_id) VALUES (?, ?, ?)').run(JSON.stringify(questionOrder), JSON.stringify(optionOrders), ownerId()));
  res.status(201).json((await getAttempt(result.lastInsertRowid, true)));
});

app.get('/api/attempts/:attemptId/questions/:questionId/chat', async (req, res) => {
  const attempt = await db.prepare('SELECT question_order FROM attempts WHERE id=? AND owner_id=?').get(Number(req.params.attemptId),ownerId());
  if (!attempt || !json(attempt.question_order,[]).includes(Number(req.params.questionId)) || !(await getQuestion(req.params.questionId))) return res.status(404).json({ error: 'Không tìm thấy ngữ cảnh câu hỏi.' });
  const messages = (await db.prepare('SELECT role, content, created_at AS createdAt FROM chat_messages WHERE attempt_id = ? AND question_id = ? ORDER BY id').all(Number(req.params.attemptId), Number(req.params.questionId)));
  res.json(messages);
});

app.post('/api/attempts/:attemptId/questions/:questionId/chat', async (req, res) => {
  if (process.env.QUIZ_TEACHER_ENABLED !== 'true') return res.status(403).json({ error: 'Giáo viên AI đang tạm khóa.' });
  const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
  const question = (await getQuestion(req.params.questionId));
  const attempt = (await db.prepare('SELECT * FROM attempts WHERE id = ? AND owner_id = ?').get(Number(req.params.attemptId), ownerId()));
  if (!attempt || !question || !json(attempt.question_order, []).includes(question.id)) return res.status(404).json({ error: 'Không tìm thấy ngữ cảnh câu hỏi.' });
  if (!message) return res.status(400).json({ error: 'Hãy nhập câu hỏi cho AI.' });
  if (!aiConfig()) return res.status(503).json({ error: 'Chưa kết nối AI: hãy cấu hình GEMINI_API_KEY hoặc OPENAI_API_KEY trong .env rồi khởi động lại server.' });

  const history = (await db.prepare('SELECT role, content FROM chat_messages WHERE attempt_id = ? AND question_id = ? ORDER BY id').all(attempt.id, question.id));
  const system = 'Bạn là gia sư trắc nghiệm. Chỉ giải thích đúng câu hỏi được cung cấp, ưu tiên gợi ý trước khi tiết lộ đáp án. Trả lời bằng tiếng Việt, giữ nguyên nội dung tiếng Anh nếu cần.';
  const order = json(attempt.option_orders, {})[question.id] || [0, 1, 2, 3];
  const selectedIndex = json(attempt.answers, {})[question.id];
  const displayedAnswer = order.indexOf(question.answerIndex);
  const displayedSelection = order.indexOf(selectedIndex);
  const userContext = `Câu hỏi: ${question.prompt}\n${order.map((optionIndex, index) => `${answerLabel(index)}. ${question.options[optionIndex]}`).join('\n')}\nTrạng thái bài: ${attempt.status}\nTrạng thái đáp án: ${question.answerStatus}\nĐáp án đã xác nhận: ${question.answerStatus === 'confirmed' && displayedAnswer >= 0 ? answerLabel(displayedAnswer) : 'Chưa xác nhận'}\nNgười học chọn: ${displayedSelection >= 0 ? answerLabel(displayedSelection) : 'Chưa chọn'}\nTrước khi người học chọn, ưu tiên gợi ý; sau khi chọn hoặc yêu cầu giải thích, dùng đáp án đã xác nhận. Không tự chốt đáp án chưa xác nhận.`;
  let reply;
  try { reply = await generateAI([{ role: 'system', content: `${system}\n\nNgữ cảnh câu hỏi đang học:\n${userContext}` }, ...history, { role: 'user', content: message }], { maxTokens: 500 }); }
  catch (error) { return res.status(502).json({ error: error.message }); }
  const save = db.prepare('INSERT INTO chat_messages (attempt_id, question_id, role, content) VALUES (?, ?, ?, ?)');
  (await save.run(attempt.id, question.id, 'user', message));
  (await save.run(attempt.id, question.id, 'assistant', reply));
  res.json({ role: 'assistant', content: reply });
});

app.use((req, res) => res.redirect('/'));
app.use((error, _req, res, _next) => {
  if (error.type === 'entity.too.large' || error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({error:'Dữ liệu vượt dung lượng 10 MB cho một lần nhập. Hãy chia tài liệu thành các phần nhỏ hơn.'});
  console.error('Request failed.', /^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : '');
  res.status(500).json({error:'Không thể xử lý yêu cầu. Vui lòng thử lại.'});
});
if (require.main === module) db.ready.then(() => app.listen(port, () => console.log(`PRO QUIZ APP đang chạy tại http://localhost:${port}`))).catch(() => {
  console.error('Không thể kết nối database. Kiểm tra cấu hình trên máy chủ.');
  process.exitCode = 1;
  db.close();
});
module.exports = app;
