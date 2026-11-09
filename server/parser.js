const QUESTION_START = /(?:^|\s)(?:(?:Câu|Cau|Question)\s*)?\d+\s*[\.:]\s*/giu;
const OPTION_START = /(?:^|\s)([ABCD])\s*[\.\):]\s*/giu;
const ANSWER_MARKER = /(?:Đáp\s*án|Dáp\s*án|Dap\s*an|Answer)\s*[:\-]?\s*([ABCD])\b/iu;

function normalizeText(value) {
  return value.replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function parseBlock(sourceText, index) {
  const answerMatch = sourceText.match(ANSWER_MARKER);
  const answerMarkerIndex = answerMatch ? answerMatch.index : sourceText.length;
  const content = sourceText.slice(0, answerMarkerIndex);
  const optionMatches = [...content.matchAll(OPTION_START)];
  const options = [];

  for (let optionIndex = 0; optionIndex < optionMatches.length; optionIndex += 1) {
    const match = optionMatches[optionIndex];
    const next = optionMatches[optionIndex + 1];
    const start = match.index + match[0].length;
    const end = next ? next.index : content.length;
    options.push({ label: match[1].toUpperCase(), text: normalizeText(content.slice(start, end)) });
  }

  const promptEnd = optionMatches.length > 0 ? optionMatches[0].index : 0;
  const prompt = normalizeText(content.slice(0, promptEnd)).replace(/^(?:(?:Câu|Cau|Question)\s*)?\d+\s*[:.)-]\s*/iu, '').trim();
  const validOptions = options.length === 4 && options.every((option, optionIndex) => option.label === String.fromCharCode(65 + optionIndex) && option.text);
  const answerIndex = answerMatch ? answerMatch[1].toUpperCase().charCodeAt(0) - 65 : null;

  return {
    importIndex: index,
    sourceText: sourceText.trim(),
    prompt,
    options: options.map((option) => option.text),
    answerIndex,
    answerStatus: answerIndex === null ? 'unconfirmed' : 'confirmed',
    answerSource: answerIndex === null ? 'not_provided' : 'source',
    valid: Boolean(prompt && validOptions),
    error: !prompt ? 'Thiếu nội dung câu hỏi.' : !validOptions ? 'Cần đủ bốn lựa chọn A, B, C và D theo đúng thứ tự.' : null
  };
}

function parseQuizText(rawText) {
  const text = typeof rawText === 'string' ? rawText.replace(/\u00a0/g, ' ').trim() : '';
  if (!text) return { questions: [], invalid: [], totalBlocks: 0 };

  const starts = [...text.matchAll(QUESTION_START)].map((match) => match.index);
  const blocks = starts.length > 0
    ? starts.map((start, index) => text.slice(start, starts[index + 1] || text.length))
    : [text];
  const parsed = blocks.map((block, index) => parseBlock(block, index + 1));

  return {
    questions: parsed.filter((question) => question.valid),
    invalid: parsed.filter((question) => !question.valid),
    totalBlocks: parsed.length
  };
}

module.exports = { parseQuizText, normalizeText };
