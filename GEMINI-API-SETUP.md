# Gemini API trực tiếp trong PRO QUIZ

Backend đã hỗ trợ `generateContent` qua REST; không cần cài SDK. Luồng Gemini được triển khai trong `server/gemini.js`, dùng chung các chức năng đề xuất đáp án và chat theo câu hỏi. OpenAI vẫn có thể dùng như trước nếu không cấu hình Gemini.

Trong `.env` ở thư mục gốc:

```dotenv
GEMINI_API_KEY=KHOA_GEMINI_CUA_BAN
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent
QUIZ_TEACHER_ENABLED=false
```

Khóa trong tài liệu là ký hiệu thay thế, không phải khóa thật. Không đưa khóa vào frontend hoặc Git. `GEMINI_API_URL` có thể bỏ trống để backend tự ghép từ `GEMINI_MODEL`; nếu tự đặt URL, model trong URL phải khớp model cấu hình. Không dùng hostname viết thiếu chữ `generativelanguage`.

Đã chuyển các biến AI hiện có trong `.env` sang `GEMINI_*`, giữ nguyên khóa của người dùng và cấu hình đăng nhập Google. Backend cũng nhận cấu hình cũ `OPENAI_API_URL` có đuôi `:generateContent` để tương thích với hướng dẫn trước.

1. Lưu `.env`, khởi động lại bằng `npm start`.
2. Mở Nhập tài liệu, dán một câu đủ A–D chưa có đáp án, chọn AI phân tích đáp án.
3. Kiểm tra đề xuất và giải thích rồi xác nhận đáp án trước khi lưu/luyện tập. Backend không tự dùng đáp án AI chưa xác nhận để chấm điểm.

Nút kiểm tra cấu hình không gọi Google. Trạng thái “Gemini đã phản hồi” chỉ xuất hiện sau khi API nhận phản hồi có nội dung. Bong bóng Giáo viên AI vẫn khóa; thay nhà cung cấp không tự mở khóa chức năng này.

HTTP 429: kiểm tra quota/rate limit trong AI Studio, thử lại sau. HTTP 503 hoặc timeout: dịch vụ/mạng chưa đáp ứng; không đồng nghĩa khóa sai. HTTP 404: kiểm tra model còn khả dụng với project, có thể phải thay model. Hạn mức miễn phí phụ thuộc model và project, không mặc định không giới hạn.

Kiểm thử tự động dùng máy chủ Gemini mô phỏng, không gọi Google thật hoặc sửa database người dùng. Bao gồm request JSON, vai trò hội thoại, nội dung nguồn, đáp án chưa xác nhận, lỗi quota, phản hồi bị chặn/cắt và khóa Giáo viên AI.

Cập nhật 08/11/2026: `gemini-flash-latest` trả 503/timeout trong các lần kiểm tra. Đã chuyển cấu hình người dùng sang `gemini-3.5-flash-lite` và nhận phản hồi thật thành công cho chat cùng đề xuất đáp án. Giáo viên AI trong `.env` đang bật theo yêu cầu người dùng; giá trị `false` ở ví dụ trên là lựa chọn khóa khi cần. Bộ ghép đáp án chấp nhận cả đối tượng `suggestions` và mảng JSON trực tiếp, vẫn xác thực ID/đáp án và không tự xác nhận. Model có Free Tier theo bảng giá tại thời điểm kiểm tra, nhưng hạn mức thực tế do Google/project quyết định.

Tham chiếu chính thức: [generateContent](https://ai.google.dev/api/generate-content), [giá](https://ai.google.dev/gemini-api/docs/pricing), [hạn mức](https://ai.google.dev/gemini-api/docs/rate-limits).
