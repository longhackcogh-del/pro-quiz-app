# Bảo vệ PRO QUIZ

## Đã áp dụng

- API kiểm tra Google ID của chủ dữ liệu; trình duyệt không được quyết định owner_id.
- Khóa Gemini, Google Client Secret và DATABASE_URL chỉ dùng ở server.
- API lượt làm bài không gửi đáp án của câu chưa trả lời. Sau khi trả lời có phản hồi ngay; bài đã nộp có đáp án để ôn.
- Chặn yêu cầu thay đổi dữ liệu từ Origin khác hoặc Sec-Fetch-Site=cross-site. Cookie xác thực vẫn bắt buộc.
- Không cho nhúng trang trong iframe; nosniff, Referrer-Policy và CSP giới hạn frame/base/object. CSP hiện chưa hạn chế script vì UI dùng inline handlers; không coi đây là biện pháp XSS toàn diện.
- Không cache API; không hiển thị X-Powered-By. Đường dẫn .env/.git/server/data trả 404.
- Chatbot tiếp tục khóa ở backend. Chưa thêm quota hoặc rate limit theo yêu cầu hiện tại.

F12 luôn có thể xem JavaScript và dữ liệu được gửi tới trình duyệt. Người dùng có thể xem đáp án trong kho do họ sở hữu, thay đổi lựa chọn sau khi nhận phản hồi và sửa giao diện trên máy mình. Đây là nền tảng tự học, chưa phải hệ thống thi/xếp hạng chống gian lận. Không dùng điểm hiện tại để trao thưởng hoặc chứng nhận.

## Khóa đã lộ trong ảnh: cần chủ tài khoản thay

Không tạo chuỗi ngẫu nhiên trong .env thay cho khóa Google thật. Không gửi khóa qua chat hoặc đưa vào GitHub.

### Google OAuth Client Secret

1. Google Cloud → đúng project PRO QUIZ → Clients → đúng OAuth client đang dùng.
2. Tạo thêm client secret mới (rotation), giữ Client ID và callback đã cấu hình.
3. Cập nhật GOOGLE_CLIENT_SECRET trong .env local và Render → Environment.
4. Save/redeploy trên Render, đăng nhập thử thành công rồi vô hiệu hóa secret cũ trong Google Cloud.

Google hỗ trợ chuyển sang secret mới trong lúc secret cũ vẫn còn hiệu lực: https://support.google.com/googleapi/answer/6158849

### Gemini

1. Trong Google AI Studio, tạo API key thay thế cho project thích hợp.
2. Cập nhật GEMINI_API_KEY tại các môi trường thực sự sử dụng nó (.env local; Render nếu đã cấu hình).
3. Kiểm tra kết nối nếu cần, sau đó thu hồi key cũ. Không bật chatbot để thử nếu chưa có nhu cầu.

Tài liệu: https://ai.google.dev/gemini-api/docs/api-key

Phần thay khóa cần thực hiện trong tài khoản Google. Thay code hoặc redeploy không tự thu hồi khóa đã lộ. Sau khi thay, giữ các key/secret chỉ trong biến môi trường riêng.

## Giới hạn

Chưa kiểm toán bảo mật độc lập, chưa chống DDoS ở cấp hạ tầng và chưa đo tải. Kiểm thử phân quyền và header không chứng minh hệ thống không còn lỗ hổng. Quản lý phiên hiện dùng RAM; restart yêu cầu đăng nhập lại.
