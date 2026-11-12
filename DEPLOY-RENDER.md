# Triển khai miễn phí: Render + Neon PostgreSQL

## 1. Tạo Neon Free

Tạo project ở Singapore nếu đặt backend tại khu vực này. Trong Connect, sao chép pooled connection string. Lưu trong `.env` trên máy hoặc DATABASE_URL trên hosting; không đưa vào GitHub. Giữ nguyên tham số TLS của Neon.

## 2. Kiểm tra local và chuyển dữ liệu cũ

Ứng dụng dùng PostgreSQL khi có DATABASE_URL và không có DATABASE_FILE, hoặc khi DATABASE_DRIVER=postgres. Dùng DATABASE_DRIVER=sqlite để quay lại database local. Không trộn hai lựa chọn khi triển khai Render.

Nếu có dữ liệu SQLite cần chuyển, dừng server local trước, rồi chạy:

```sh
node scripts/migrate-sqlite-to-postgres.js
```

Script đọc `./data/pro-quiz.sqlite`, tạo bản sao trong `data/backups/`, kiểm tra Neon rỗng và chuyển trong một transaction. Nếu Neon đã có bất kỳ dữ liệu ứng dụng nào, script từ chối ghi đè. Giữ nguyên Google ID và ID bản ghi để liên kết bài làm/câu sai/chat không bị mất. Không tự đồng bộ dữ liệu hai chiều sau migration.

Sau đó chạy `npm start` để dùng Neon. Khi đổi database cần đăng nhập Google lại. Nếu dùng server khác, đổi SQLITE_MIGRATION_SOURCE cho đúng file nguồn. Không ghi đè hoặc xóa source để thử lại migration.

## 3. Tạo Render Free từ Blueprint

[Mở Blueprint](https://render.com/deploy?repo=https://github.com/longhackcogh-del/pro-quiz-app).

`render.yaml` khai báo **plan: free**, không có persistent disk. Kiểm tra màn hình xác nhận vẫn là Free; không nâng cấp sang dịch vụ trả phí.

- Build: `npm ci --omit=dev`
- Start: `npm start`
- Node.js: 24
- DATABASE_DRIVER: postgres
- DATABASE_URL: chuỗi Neon (secret)
- Health check: `/healthz`
- QUIZ_TEACHER_ENABLED: false
- Auto deploy: checksPass
- Không đặt DATABASE_FILE trên Render. Không cần PORT thủ công.

Điền GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET và GOOGLE_REDIRECT_URI vào biến riêng trên Render. Khi có URL dịch vụ thật, sửa callback thành `https://TEN-DICH-VU.onrender.com/auth/google/callback` và đăng ký chính xác trong Google Cloud. `TEN-DICH-VU` là ví dụ, phải thay bằng hostname thật. Kiểm tra Audience/test users nếu OAuth còn Testing.

CHATBOT_URL để trống khi chưa có ứng dụng PDF HTTPS riêng. Không trỏ localhost trên production. Gemini API key không bắt buộc khi chỉ dùng các chức năng không gọi AI.

## 4. Kiểm tra online

- `/healthz` trả 200, status ok.
- Đăng nhập Google thật, logout và đăng nhập lại.
- Hai tài khoản có dữ liệu riêng.
- Nhập đề, xác nhận đáp án, tạo/chuyển bộ, làm bài, ôn câu sai.
- Dữ liệu vẫn còn sau restart/deploy. Thử một bản ghi nhận diện được rồi xóa bằng giao diện sau khi kiểm tra.
- Kiểm tra mobile và trạng thái chatbot khóa.

## 5. Cập nhật và giới hạn nền tảng

Sửa local → `npm test` → commit → push nhánh main. GitHub Actions kiểm tra cả SQLite và PostgreSQL 17. Render triển khai sau khi checks pass; nếu không có checks thì Render có thể deploy mà không chờ test, nên giữ workflow CI bật.

Auto-deploy còn yêu cầu kết nối Git provider cho dịch vụ. Nếu tạo từ URL repo công khai mà chưa liên kết GitHub, cần **Manual Deploy → Deploy latest commit**. Kiểm tra commit đang Live có trùng commit mới trên GitHub; push thành công chưa xác nhận website đã cập nhật. Xem https://render.com/docs/deploys và https://render.com/docs/git-provider.

Render Free ngủ sau 15 phút không có traffic; lượt truy cập đầu có thể chậm. Phiên đăng nhập lưu RAM nên restart/ngủ có thể yêu cầu đăng nhập lại; bài làm nằm trong Neon. Neon Free cũng có quota tài nguyên và có thể scale to zero. Các quota này do nhà cung cấp áp dụng, chưa phải giới hạn gói người dùng trong PRO QUIZ.

Không có cam kết uptime hoặc chịu tải lớn. Sao lưu PostgreSQL định kỳ ra nơi riêng và thử khôi phục. Rollback code không tự rollback dữ liệu/schema. Database SQLite cũ vẫn giữ nguyên nhưng sẽ không nhận các thay đổi phát sinh ở Neon.

## Tài liệu

- https://render.com/docs/free
- https://render.com/docs/blueprint-spec
- https://neon.com/pricing
- https://neon.com/docs/get-started/connect-neon
