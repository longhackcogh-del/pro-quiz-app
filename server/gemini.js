async function generateGemini(config, messages, { jsonMode = false, maxTokens = 500 } = {}) {
  const instructions = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
  const contents = messages.filter(message => message.role !== 'system').map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }));
  let response;
  try {
    response = await fetch(config.url, { method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.key }, body: JSON.stringify({ ...(instructions && { systemInstruction: { parts: [{ text: instructions }] } }), contents, generationConfig: { maxOutputTokens: Math.max(2048, maxTokens), ...(jsonMode && { responseMimeType: 'application/json' }) } }) });
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'Gemini quá thời gian phản hồi. Hãy thử lại.' : 'Không thể kết nối Gemini. Kiểm tra mạng của backend rồi thử lại.');
  }
  if (!response.ok) {
    const reasons = { 400: 'Kiểm tra khóa, model và định dạng yêu cầu Gemini.', 401: 'Khóa Gemini không hợp lệ.', 403: 'Khóa hoặc project chưa có quyền dùng Gemini.', 404: 'Model Gemini không tồn tại hoặc không còn khả dụng cho project. Kiểm tra model trong AI Studio.', 429: 'Đã đạt hạn mức Gemini hoặc giới hạn tần suất. Kiểm tra quota trong AI Studio và thử lại sau.' };
    throw new Error(`Gemini trả HTTP ${response.status}. ${reasons[response.status] || 'Dịch vụ chưa sẵn sàng. Hãy thử lại sau.'}`);
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('Gemini trả phản hồi không hợp lệ. Hãy thử lại.'); }
  const candidate = data?.candidates?.[0];
  if (data?.promptFeedback?.blockReason || (candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS')) throw new Error('Gemini không thể xử lý nội dung này. Hãy kiểm tra lại đề.');
  if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('Phản hồi Gemini bị cắt do giới hạn token. Hãy chia nhỏ đề và thử lại.');
  const text = candidate?.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('').trim();
  if (!text) throw new Error('Gemini trả nội dung rỗng. Hãy thử lại.');
  return text;
}
module.exports = { generateGemini };
