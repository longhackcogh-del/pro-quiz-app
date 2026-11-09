# Thiết lập đăng nhập Google cho PRO QUIZ

Code đăng nhập đã có trong `server/google-auth.js`. Để dùng với tài khoản Google thật, chủ ứng dụng cần tạo OAuth client của mình. Không cần bật thanh toán API OpenAI để đăng nhập Google; hai dịch vụ độc lập.

## 1. Tạo cấu hình ở Google

1. Mở [Google Cloud Console](https://console.cloud.google.com/), tạo hoặc chọn project dành cho PRO QUIZ.
2. Mở **Google Auth Platform** và hoàn thành thiết lập: tên ứng dụng, email hỗ trợ/liên hệ và Audience. Chọn External nếu cần sử dụng tài khoản Google cá nhân bên ngoài tổ chức.
3. Nếu project đang ở chế độ Testing và Google giới hạn tài khoản thử nghiệm, vào Audience → Test users để thêm email bạn sẽ dùng thử.
4. Vào Clients → Create client → chọn **Web application**, đặt tên `PRO QUIZ Local`.
5. Trong **Authorized redirect URIs**, thêm chính xác:

```text
http://localhost:3000/auth/google/callback
```

6. Lưu Client ID và Client Secret vào file `.env` trên máy. Không gửi Client Secret vào chat hoặc đưa vào Git.

Ứng dụng dùng authorization code ở backend, không cần nhúng Google client secret vào HTML hoặc nhập mật khẩu Google trong app. Tham chiếu: [Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## 2. Điền .env

Các dòng đã được chuẩn bị trong `.env`. Giữ nguyên cấu hình AI và database có sẵn; chỉ điền các giá trị Google:

```dotenv
GOOGLE_CLIENT_ID=CLIENT_ID_CUA_BAN
GOOGLE_CLIENT_SECRET=CLIENT_SECRET_CUA_BAN
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

Hai giá trị đầu là ký hiệu trong tài liệu, không phải thông tin hợp lệ. Không chép chúng làm khóa thật.

Nếu đang dùng cổng khác, thay cổng ở cả `.env` và cấu hình Google. Khi triển khai công khai, dùng callback HTTPS theo domain thật và đăng ký đúng URI đó ở Google.

## 3. Khởi động lại và thử

1. Dừng server cũ bằng Ctrl+C trong terminal đang chạy app.
2. Chạy `npm start` trong thư mục `reference1`.
3. Mở `http://localhost:3000`, nhấn Ctrl+F5.
4. Nhấn **Đăng nhập Google**: nếu chưa có phiên và cấu hình đã đầy đủ, app chuyển thẳng đến Google, không mở cửa sổ trung gian. Khi đã đăng nhập, nút mở thông tin tài khoản để đăng xuất.
5. Chọn tài khoản ở trang Google, chấp nhận các quyền danh tính/email cơ bản.
6. Sau khi quay lại PRO QUIZ, sidebar và màn hình tài khoản phải hiện đúng tên/email. Tải lại trang để xác nhận phiên còn hiệu lực, rồi thử đăng xuất.

Nếu trình duyệt đã có phiên Google, thường chỉ cần chọn tài khoản. Việc có yêu cầu mật khẩu hoặc xác minh bổ sung hay không do Google quyết định; ứng dụng không bỏ qua bước bảo mật đó. Nếu người dùng hủy hoặc Google trả lỗi, app hiện cửa sổ thông báo để thử lại, không tự chuyển hướng lặp.

Nếu mở app bằng `127.0.0.1`, nút đăng nhập đưa về hostname đã cấu hình để cookie trạng thái và callback cùng một nơi.

## 4. Các tình huống thường gặp

| Thông báo | Cần kiểm tra |
| --- | --- |
| Chưa được thiết lập | Hai khóa Google và URI callback trong `.env`, sau đó khởi động lại server |
| `redirect_uri_mismatch` ở Google | URI đăng ký phải trùng hoàn toàn hostname, cổng, đường dẫn và giao thức |
| Tài khoản không được phép | Audience, trạng thái thử nghiệm và danh sách test users trên Google |
| Phiên không hợp lệ/hết hạn | Bắt đầu lại từ nút đăng nhập, cho phép cookie; không dùng URL callback cũ |
| Google chưa xác thực được | Client ID/Secret cùng một OAuth client, secret còn hiệu lực và máy chủ kết nối được Google |
| Quay về nhưng không có phiên | Cookie không bị chặn, dùng cùng hostname với callback |

## Phạm vi hiện tại

- Kho câu hỏi, bộ câu hỏi, bài làm, câu sai và hội thoại được tách theo Google ID của từng tài khoản. Đăng xuất sẽ xóa dữ liệu tài khoản khỏi giao diện; dữ liệu vẫn được giữ trong database.
- Kho chung cũ chỉ được nhận bởi email Google đã xác thực khớp `LEGACY_OWNER_EMAIL` trong `.env`, một lần duy nhất. Server sao lưu database trước khi thêm phân quyền vào dữ liệu cũ, trong `data/backups/`.
- Phiên được giữ trong bộ nhớ server trong 8 giờ; khởi động lại server sẽ kết thúc phiên. Chưa có kho phiên dùng chung cho nhiều server.
- Google access token chỉ dùng ở backend để lấy danh tính, không lưu vào cookie hoặc trả về frontend.
- Khách có thể xem giao diện và hướng dẫn; cần đăng nhập Google để sử dụng dữ liệu cá nhân.
- Kiểm thử tự động dùng Google mô phỏng. Chỉ xác nhận đăng nhập Google thật sau khi hoàn thành bước 3 bằng OAuth client của bạn.
