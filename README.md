# PRO QUIZ APP

Ứng dụng luyện thi cá nhân: nhập tài liệu, xác nhận đáp án, quản lý bộ câu hỏi và ôn câu sai. Dữ liệu được tách theo tài khoản Google.

## Chức năng

- Google OAuth với authorization code, PKCE và cookie phiên phía server.
- Kho câu hỏi riêng: tạo/đổi tên/xóa bộ, chuyển câu hỏi và luyện tập từng bộ.
- Nhập TXT, DOCX, PDF có lớp văn bản; xem trước và chỉnh sửa trước khi lưu.
- Chấm điểm, lưu tiến trình, kết quả và lịch sử câu sai.
- Hai hướng dẫn dùng Gemini bên ngoài để chuẩn hóa câu hỏi hoặc tạo đề theo chương giáo trình.
- Giáo viên AI dạng bong bóng, hiện **tạm khóa**. API key chỉ dùng ở backend.

## Công nghệ

HTML/CSS/JavaScript thuần → Express trên Node.js 24 → SQLite (`node:sqlite`). Google OAuth xác thực tài khoản; Gemini được tích hợp tại backend.

## Chạy local

```sh
npm ci
```

Sao chép `.env.example` thành `.env`, điền Google OAuth theo [hướng dẫn](GOOGLE-LOGIN-SETUP.md), rồi chạy:

```sh
npm start
```

Mở http://localhost:3000. Chưa cấu hình Google thì có thể xem giao diện nhưng không truy cập kho cá nhân. Không commit `.env` hoặc database.

## Kiểm thử

```sh
npm test
```

Tests dùng database tạm và nhà cung cấp Google/AI mô phỏng, không gọi AI thật. Kiểm thử trình duyệt dùng Chrome/Edge headless; có thể chỉ định executable bằng `PRO_QUIZ_TEST_BROWSER`. CI trên GitHub yêu cầu Chrome và chạy toàn bộ suite.

## Triển khai và cập nhật

[Hướng dẫn Render](DEPLOY-RENDER.md) · [Cấu hình Blueprint](render.yaml) · [GitHub Actions](.github/workflows/ci.yml)

Blueprint dùng **dịch vụ trả phí và persistent disk**, giữ SQLite qua restart/deploy. Không tạo dịch vụ trả phí trước khi chủ tài khoản xem chi phí. Sau khi kết nối GitHub và Render, deploy tự động khi các checks của commit trên nhánh triển khai đã pass. `/healthz` kiểm tra ứng dụng truy cập được database.

Ứng dụng chạy trên hosting sẽ không phụ thuộc VS Code hoặc máy cá nhân.

## Cấu trúc

```text
public/                    Giao diện và hành vi trình duyệt
server/app.js              API nhập đề, luyện tập, chấm điểm, AI
server/google-auth.js      Google OAuth và phiên đăng nhập
server/ownership.js        Phân quyền và nhận kho chung cũ
server/question-sets.js    Quản lý bộ câu hỏi cá nhân
server/database.js         Schema SQLite và migration
server/parser.js           Tách câu hỏi A–D và đáp án
server/gemini.js           Gọi Gemini từ backend
tests/                     API và browser integration tests
```

## Phạm vi và hạn chế

- Chưa có thanh toán hoặc quota theo gói; chưa thêm hạn mức sử dụng trong lượt chuẩn bị deploy.
- Phiên đăng nhập lưu trong RAM trong 8 giờ: restart/deploy cần đăng nhập lại. Chưa hỗ trợ nhiều instance chia sẻ phiên.
- Chưa có OCR cho PDF scan. Không bảo đảm đáp án AI luôn đúng; cần người dùng kiểm tra.
- Trợ lý PDF trong `ai-pdf-chatbot-langchain/` là ứng dụng bên thứ ba có repo riêng, không nằm trong bản triển khai này. Muốn dùng cần deploy riêng và cấu hình `CHATBOT_URL` HTTPS.
- Chưa xác nhận Google OAuth thật trên domain production hoặc khả năng chịu tải. Kiểm thử tự động không thay thế những kiểm tra này.
- Không có cam kết phục vụ công khai quy mô lớn; cần gia cố, theo dõi và đo tải trước khi mở rộng.

## Portfolio / CV

Sau khi triển khai thành công, thêm URL thật vào phần About của GitHub và README. Có thể dùng mô tả:

> Xây dựng ứng dụng luyện thi với Node.js, Express và SQLite; tích hợp Google OAuth, dữ liệu riêng theo tài khoản, nhập tài liệu, quản lý bộ câu hỏi và ôn câu sai. Bổ sung kiểm thử tích hợp và cấu hình CI/deployment.

Chỉ ghi link demo, số người dùng và kết quả chịu tải đã thực sự kiểm chứng. Mã tham chiếu thiết kế/C++ được giữ lại để đối chiếu; kiểm tra quyền sử dụng tài sản trước khi chọn giấy phép phát hành.
