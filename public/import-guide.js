const wordPreparationPrompt = `Gemini: Tôi sẽ đính kèm một hoặc nhiều tài liệu gốc. Hãy xử lý chúng để nhập vào PRO QUIZ APP và tạo một file Word (.docx) có thể tải xuống, tên pro-quiz-cau-hoi.docx.

Yêu cầu:
1. Đọc tài liệu đính kèm. Nếu tài liệu đã có câu trắc nghiệm, trích xuất đầy đủ và giữ nguyên ý nghĩa, dữ kiện và ngôn ngữ gốc. Nếu là tài liệu lý thuyết, tạo câu trắc nghiệm chỉ dựa trên kiến thức có trong tài liệu.
2. Mỗi câu phải có đúng bốn lựa chọn A, B, C, D và chỉ một đáp án đúng. Nội dung câu hỏi, mỗi lựa chọn và đáp án phải nằm ở các đoạn văn riêng, không xuống dòng chung nhiều lựa chọn.
3. Ghi đáp án ngay dưới lựa chọn D theo đúng mẫu: Đáp án: A hoặc Đáp án: B hoặc Đáp án: C hoặc Đáp án: D. Ưu tiên đáp án nguồn; nếu không có, xác định dựa trên nội dung tài liệu. Không tự gán đáp án khi thiếu dữ kiện hoặc chưa chắc chắn.
4. Câu phụ thuộc đoạn văn phải kèm đoạn văn cần thiết trong nội dung câu hỏi. Câu thiếu hình ảnh, dữ kiện hoặc không xác định được một đáp án đúng: không đưa vào file nhập; liệt kê riêng trong tin nhắn để tôi bổ sung.
5. Đánh số liên tục bằng văn bản thường: Câu 1:, Câu 2:, ... Không dùng danh sách đánh số tự động, bảng, cột, hộp văn bản, ảnh thay chữ, công thức dạng ảnh hoặc bảng đáp án riêng cuối file. Không thêm lời dẫn, giải thích hay tiêu đề vào file. Giữ một dòng trống giữa hai câu.

Ví dụ định dạng chính xác cho một câu đã xử lý (chỉ là mẫu, KHÔNG chép câu này vào file nếu không thuộc tài liệu):

Câu 1: Thủ đô của Việt Nam là thành phố nào?
A. Thành phố Hồ Chí Minh
B. Đà Nẵng
C. Hà Nội
D. Hải Phòng
Đáp án: C

Trước khi xuất, kiểm tra mọi câu đều có nội dung đầy đủ, đủ A–D và đáp án khớp một lựa chọn. Tạo file Word .docx thật và cung cấp liên kết tải xuống trong cuộc trò chuyện, không chỉ dán nội dung. Báo số câu đã xuất và các phần cần bổ sung trong tin nhắn bên ngoài file. Nếu công cụ hiện tại không hỗ trợ tạo file, nói rõ; không tạo liên kết tải giả.Hãy tạo file word`;

function openImportGuide() {
  $('#word-preparation-prompt').value = wordPreparationPrompt;
  $('#prompt-copy-status').textContent = '';
  if (!$('#import-guide').open) $('#import-guide').showModal();
}
async function copyWordPrompt() {
  const input = $('#word-preparation-prompt');
  try {
    await navigator.clipboard.writeText(wordPreparationPrompt);
    $('#prompt-copy-status').textContent = 'Đã sao chép. Dán vào Gemini và đính kèm tài liệu gốc của bạn.';
  } catch {
    input.focus();
    input.select();
    $('#prompt-copy-status').textContent = 'Trình duyệt chưa cho phép sao chép tự động. Câu lệnh đã được chọn; nhấn Ctrl+C (hoặc chạm giữ để sao chép).';
  }
}
function choosePreparedWord() {
  if (!state.importBusy) $('#prepared-word-input').click();
}
async function uploadPreparedWord(event) {
  if (!event.target.files?.length || state.importBusy) return;
  $('#import-guide').close();
  setView('v-paste');
  await processLocalFileParsing(event);
  event.target.value = '';
}
document.addEventListener('DOMContentLoaded', () => {
  $('#import-guide').addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
});
