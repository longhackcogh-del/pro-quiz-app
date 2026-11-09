const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mergeSuggestions, suggestAnswers } = require('../server/ai-suggestions');

const text = '1. Could you check the departure time .............. we leave for the airport? A. throughout B. during C. until D. before\n\n2. According to the passage, why did he leave? A. Work B. Study C. Travel D. Family';
const draft = (id) => ({ id, prompt: 'Original question?', options: ['a', 'b', 'c', 'd'], sourceText: 'Original source', answerIndex: null, answerSource: 'not_provided' });

test('Merge only by ID, preserve content, and reject missing/duplicate/invalid suggestions', () => {
  const questions = [draft('one'), draft('two'), draft('three'), draft('four')];
  const output = mergeSuggestions(questions, [
    { id: 'two', answerIndex: null, needsReview: true, reason: 'Missing passage' },
    { id: 'one', answerIndex: 3, needsReview: false, reason: 'Before fits.', prompt: 'REWRITTEN', options: ['wrong'] },
    { id: 'unknown', answerIndex: 0, needsReview: false, reason: 'Ignore' },
    { id: 'three', answerIndex: 0, needsReview: false, reason: 'First' },
    { id: 'three', answerIndex: 1, needsReview: false, reason: 'Duplicate' }
  ]);
  assert.equal(output[0].aiSuggestionIndex, 3);
  assert.equal(output[0].prompt, questions[0].prompt);
  assert.deepEqual(output[0].options, questions[0].options);
  assert.equal(output[0].sourceText, questions[0].sourceText);
  assert.ok(output.every((question) => question.answerIndex === null && question.answerStatus === 'unconfirmed'));
  assert.ok(output.slice(1).every((question) => question.needsReview && question.aiSuggestionIndex === null));
  for (const answerIndex of [null, '', '0', false, -1, 4]) {
    assert.equal(mergeSuggestions([draft('one')], [{ id: 'one', answerIndex, reason: 'Invalid', needsReview: false }])[0].aiSuggestionIndex, null);
  }
});

test('Malformed or empty AI payloads leave the original draft marked for review', async () => {
  for (const response of ['null', '{}', '{"suggestions":null}', 'not JSON']) {
    const [question] = await suggestAnswers([draft('one')], async () => response);
    assert.equal(question.prompt, 'Original question?');
    assert.equal(question.aiSuggestionIndex, null);
    assert.equal(question.answerIndex, null);
    assert.equal(question.needsReview, true);
  }
});

test('Gemini JSON array suggestions still match by ID and remain unconfirmed', async () => {
  const [question] = await suggestAnswers([draft('one')], async () => JSON.stringify([{id:'one',answerIndex:2,reason:'Verified explanation.',needsReview:false}]));
  assert.equal(question.aiSuggestionIndex,2);
  assert.equal(question.answerIndex,null);
  assert.equal(question.answerStatus,'unconfirmed');
  assert.equal(question.prompt,'Original question?');
});

test('HTTP: TXT/paste → AI proposal → confirmation → shared bank → shuffled grading', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-quiz-test-'));
  process.env.DATABASE_FILE = path.join(directory, 'test.sqlite');
  process.env.OPENAI_API_KEY = '';
  process.env.QUIZ_TEACHER_ENABLED = 'true';
  process.env.GEMINI_API_KEY = '';
  let malformed = false;
  let failAI = false;
  let providerStatus = 500;
  const requests = [];
  const provider = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload);
    if (failAI) { res.writeHead(providerStatus); res.end('{"error":{"message":"RAW PROVIDER ERROR MUST NOT BE RETURNED"}}'); return; }
    if (!payload.response_format) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'TEST CHAT REPLY' } }] }));
      return;
    }
    const input = JSON.parse(payload.messages.at(-1).content);
    const suggestions = input.map((question) => ({
      id: question.id,
      answerIndex: question.prompt.includes('passage') ? null : 3,
      reason: question.prompt.includes('passage') ? 'Cần xem lại: thiếu đoạn văn.' : 'Before diễn tả việc kiểm tra trước khi rời đi.',
      needsReview: question.prompt.includes('passage'),
      prompt: 'AI must never overwrite this'
    })).reverse();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: malformed ? 'invalid JSON' : JSON.stringify({ suggestions }) } }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  process.env.OPENAI_API_URL = `http://127.0.0.1:${provider.address().port}`;
  const app = require('./auth-client').loadAuthenticatedApp();
  const db = require('../server/database');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetch = await require('./auth-client').authenticatedFetch(base);
  t.after(async () => {
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => provider.close(resolve))]);
    db.close();
    const target = path.resolve(directory);
    if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('pro-quiz-test-')) fs.rmSync(target, { recursive: true, force: true });
  });
  async function request(route, body, method = 'POST') {
    const response = await fetch(base + route, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  const pasted = await request('/api/imports/preview', { text });
  assert.equal(pasted.status, 200);
  assert.equal(pasted.data.questions.length, 2);
  assert.ok(pasted.data.questions.every((question) => question.answerIndex === null && typeof question.id === 'string'));
  assert.notEqual(pasted.data.questions[0].id, pasted.data.questions[1].id);
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/plain' }), 'no-answers.txt');
  const file = await fetch(base + '/api/imports/file', { method: 'POST', body: form });
  assert.equal(file.status, 200);
  assert.equal((await file.json()).text, text);
  const fixture = require('./document-fixtures');
  const documentText = '1. What is two plus two?\nA. One\nB. Two\nC. Three\nD. Four\nAnswer: D';
  for (const [extension,buffer] of [['docx',await fixture.docx(documentText)],['pdf',fixture.pdf(documentText)]]) {
    const upload = new FormData();
    upload.append('file',new Blob([buffer]),`exam.${extension}`);
    const response = await fetch(base+'/api/imports/file',{method:'POST',body:upload});
    assert.equal(response.status,200,`${extension} extraction`);
    const extracted = (await response.json()).text;
    assert.ok(extracted.includes('What is two plus two?'));
    assert.equal((await request('/api/imports/preview',{text:extracted})).data.questions.length,1);
  }
  const unsupported = new FormData();
  unsupported.append('file',new Blob(['unsupported']),'exam.exe');
  assert.equal((await fetch(base+'/api/imports/file',{method:'POST',body:unsupported})).status,415);
  const missingKey = await request('/api/imports/ai-preview', { questions: pasted.data.questions });
  assert.equal(missingKey.status, 503);
  process.env.GEMINI_API_KEY = '';
  assert.equal((await request('/api/ai/status')).data.configured, false);
  assert.equal((await request('/api/stats')).data.total, 0);
  process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
  process.env.OPENAI_MODEL = 'test-chat-model';
  const status = (await request('/api/ai/status')).data;
  assert.equal(status.provider, 'OpenAI');
  assert.equal(status.model, 'test-chat-model');
  assert.equal(status.connectionVerified, false);
  assert.equal(status.key, undefined);
  const duplicate = await request('/api/imports/ai-preview', { questions: [pasted.data.questions[0], pasted.data.questions[0]] });
  assert.equal(duplicate.status, 400);
  const proposed = await request('/api/imports/ai-preview', { questions: pasted.data.questions });
  assert.equal(proposed.status, 200);
  assert.equal(requests.at(-1).model, 'test-chat-model');
  assert.equal(requests.at(-1).max_completion_tokens, 4000);
  assert.equal(requests.at(-1).store, false);
  assert.equal(requests.at(-1).response_format.type, 'json_object');
  const [first, second] = proposed.data.questions;
  assert.equal(first.id, pasted.data.questions[0].id);
  assert.equal(first.prompt, pasted.data.questions[0].prompt);
  assert.deepEqual(first.options, pasted.data.questions[0].options);
  assert.equal(first.aiSuggestionIndex, 3);
  assert.equal(first.answerIndex, null);
  assert.equal(second.aiSuggestionIndex, null);
  assert.equal(second.needsReview, true);
  malformed = true;
  const badJSON = await request('/api/imports/ai-preview', { questions: pasted.data.questions });
  assert.ok(badJSON.data.questions.every((question) => question.needsReview && question.answerIndex === null));
  malformed = false;
  failAI = true;
  assert.equal((await request('/api/imports/ai-preview', { questions: pasted.data.questions })).status, 502);
  for (const errorStatus of [401, 429]) {
    providerStatus = errorStatus;
    const failed = await request('/api/imports/ai-preview', { questions: pasted.data.questions });
    assert.equal(failed.status, 502);
    assert.ok(failed.data.error.includes(String(errorStatus)));
    assert.ok(!failed.data.error.includes('RAW PROVIDER ERROR'));
  }
  failAI = false;
  const invalidImport = await request('/api/questions/import', { questions: [first, { ...second, options: [''] }] });
  assert.equal(invalidImport.status, 400);
  assert.equal((await request('/api/stats')).data.total, 0);
  const saved = await request('/api/questions/import', { questions: [{ ...first, answerIndex: 3, answerStatus: 'confirmed', answerSource: 'ai_suggestion' }, second] });
  assert.equal(saved.status, 201);
  assert.ok(saved.data.imported.every((question) => question.answerStatus === 'unconfirmed' && question.answerIndex === null));
  assert.equal(saved.data.imported[0].aiSuggestionIndex, 3);
  assert.equal(saved.data.imported[0].sourceText, first.sourceText);
  assert.equal((await request('/api/attempts', {})).status, 400);
  const id = saved.data.imported[0].id;
  assert.equal((await request(`/api/questions/${id}`, { answerIndex: null }, 'PATCH')).status, 400);
  const storedSuggestion = await request(`/api/questions/${id}/ai-suggest`, {});
  assert.equal(storedSuggestion.data.answerIndex, null);
  assert.equal(storedSuggestion.data.answerStatus, 'unconfirmed');
  const confirmed = await request(`/api/questions/${id}`, { answerIndex: 3 }, 'PATCH');
  assert.equal(confirmed.data.answerStatus, 'confirmed');
  // Appending from preview uses explicit confirmation and preserves the original source.
  const extra = await request('/api/questions/import', { questions: [{ ...first, prompt: first.prompt + ' (edited)', answerIndex: 2, confirmed: true }] });
  assert.equal(extra.data.imported[0].answerIndex, 2);
  assert.equal(extra.data.imported[0].sourceText, first.sourceText);
  assert.equal((await request('/api/stats')).data.total, 3);
  const attempt = (await request('/api/attempts', {})).data;
  assert.equal(attempt.total, 2);
  assert.ok(attempt.questions.every((question) => question.answerStatus === 'confirmed'));
  assert.ok(!attempt.questions.some((question) => question.id === saved.data.imported[1].id));
  assert.ok(attempt.questions.every(question => !Object.hasOwn(question,'answerIndex')));
  const bankAnswers=new Map((await request('/api/questions')).data.map(question=>[question.id,question.answerIndex]));
  for (const [index, question] of attempt.questions.entries()) {
    assert.deepEqual(question.options.map((option) => option.index).sort(), [0, 1, 2, 3]);
    await request(`/api/attempts/${attempt.id}/answer`, { questionId: question.id, selectedIndex: (bankAnswers.get(question.id) + 1) % 4, currentIndex: index }, 'PATCH');
    await request(`/api/attempts/${attempt.id}/answer`, { questionId: question.id, selectedIndex: bankAnswers.get(question.id), currentIndex: index }, 'PATCH');
  }
  const result = await request(`/api/attempts/${attempt.id}/submit`, {});
  assert.equal(result.data.score, 2);
  assert.equal(result.data.wrongCount, 0);
  const dashboard = (await request('/api/dashboard')).data;
  assert.equal(dashboard.completedAttempts, 1);
  assert.equal(dashboard.accuracy, 100);
  assert.equal(dashboard.recent[0].id, attempt.id);
  assert.equal(dashboard.recent[0].status, 'completed');
  const exported = await fetch(base + '/api/questions/export');
  assert.equal(exported.status, 200);
  assert.ok(exported.headers.get('content-disposition').includes('pro-quiz-bank.txt'));
  assert.ok((await exported.text()).includes(first.prompt));
  const chatQuestion = result.data.questions[0];
  const chatPath = `/api/attempts/${attempt.id}/questions/${chatQuestion.id}/chat`;
  const chat = await request(chatPath, { message: 'Explain this answer' });
  assert.equal(chat.status, 200);
  assert.equal(chat.data.content, 'TEST CHAT REPLY');
  const chatPayload = requests.at(-1);
  assert.equal(chatPayload.model, 'test-chat-model');
  assert.equal(chatPayload.response_format, undefined);
  assert.equal(chatPayload.max_completion_tokens, 500);
  chatQuestion.options.forEach((option, index) => assert.ok(chatPayload.messages[0].content.includes(`${String.fromCharCode(65 + index)}. ${option.text}`)));
  const displayedAnswer = chatQuestion.options.findIndex((option) => option.index === chatQuestion.answerIndex);
  assert.ok(chatPayload.messages[0].content.includes(`Đáp án đã xác nhận: ${String.fromCharCode(65 + displayedAnswer)}`));
  assert.equal((await request(chatPath)).data.length, 2);
  await request(chatPath, { message: 'Explain more' });
  assert.equal(requests.at(-1).messages.length, 4);
  const otherPath = `/api/attempts/${attempt.id}/questions/${attempt.questions[1].id}/chat`;
  await request(otherPath, { message: 'Different question' });
  assert.equal(requests.at(-1).messages.length, 2);
  assert.equal((await request('/api/ai/status')).data.connectionVerified, true);
  process.env.OPENAI_API_KEY = '';
  const chatBefore = db.prepare('SELECT COUNT(*) AS count FROM chat_messages').get().count;
  assert.equal((await request(chatPath, { message: 'No key' })).status, 503);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_messages').get().count, chatBefore);
  process.env.QUIZ_TEACHER_ENABLED = 'false';
  const providerCalls = requests.length;
  assert.equal((await request(chatPath, {message:'Blocked'})).status,403);
  assert.equal((await request('/api/ai/status')).data.teacherEnabled,false);
  assert.equal(requests.length,providerCalls);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_messages').get().count,chatBefore);
  // Wrong-answer review, grouping, retry and destructive controls use only this test database.
  const wrongAttempt = (await request('/api/attempts', {})).data;
  const wrongQuestion = wrongAttempt.questions[0];
  await request(`/api/attempts/${wrongAttempt.id}/answer`, {questionId:wrongQuestion.id,selectedIndex:(bankAnswers.get(wrongQuestion.id)+1)%4,currentIndex:0}, 'PATCH');
  assert.equal((await request(`/api/attempts/${wrongAttempt.id}/submit`, {})).data.wrongCount, 2);
  const wrongHistory = (await request('/api/wrong-answers')).data;
  assert.equal(wrongHistory.length,2);
  assert.ok(wrongHistory.every(question => question.attemptId === wrongAttempt.id));
  const retry = (await request(`/api/attempts/${wrongAttempt.id}/retry-wrong`, {})).data;
  assert.equal(retry.total,2);
  const reset = await fetch(base+'/api/progress',{method:'DELETE'});
  assert.equal(reset.status,204);
  assert.equal((await request('/api/stats')).data.activeAttemptId,null);
  assert.equal((await request('/api/stats')).data.total,3);
  assert.equal((await fetch(base+'/api/wrong-answers/export')).status,200);
  assert.equal((await fetch(base+'/api/questions/all',{method:'DELETE'})).status,204);
  assert.equal((await request('/api/stats')).data.total,0);
});
