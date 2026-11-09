# Đưa PRO QUIZ lên Render

## 1. Repository

Tạo repo của bạn và push source của thư mục gốc. `.gitignore` loại trừ bí mật, database, artifacts và ứng dụng PDF có repo riêng. Không upload file `.env`. Nếu khóa từng vào Git, thay khóa và xử lý lịch sử trước khi công khai.

## 2. Tạo dịch vụ từ Blueprint

Trong Render: New → Blueprint → kết nối repo → chọn nhánh `main`. Render đọc `render.yaml`.

Blueprint khai báo Web Service gói `starter` và disk 1 GB. Đây là cấu hình **có phí**: xem số tiền trên màn hình Render trước khi tạo. Free Web Service không hỗ trợ persistent disk và không giữ được SQLite ổn định qua restart/deploy.

- Build: `npm ci --omit=dev`
- Start: `npm start`
- Node: 24.15.0
- Disk: `/var/data`
- Database: `/var/data/pro-quiz.sqlite`
- Health check: `/healthz`
- Auto deploy: `checksPass`
- Không đặt PORT=3000 thủ công; ứng dụng dùng PORT do hosting cung cấp.

## 3. Google OAuth

Điền GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET vào biến môi trường riêng của Render. Với URL thật của dịch vụ, đặt GOOGLE_REDIRECT_URI là:

```text
https://TEN-DICH-VU.onrender.com/auth/google/callback
```

Đăng ký chính xác URI này trong Google Cloud. `TEN-DICH-VU` chỉ là ví dụ, không chép nguyên. Kiểm tra Audience/test users nếu OAuth còn Testing. Nếu chưa biết URL khi tạo Blueprint, dùng hostname dự kiến rồi sửa theo URL thực tế trước khi thử đăng nhập.

QUIZ_TEACHER_ENABLED giữ `false`. Không cần Gemini API key để dùng các chức năng không gọi AI. CHATBOT_URL để trống khi chưa deploy ứng dụng PDF riêng, tránh trỏ tới localhost của khách.

## 4. Dữ liệu và bản sao lưu

Deploy mới tạo database rỗng. Dữ liệu máy cá nhân không tự đi theo code lên GitHub.

Nếu cần chuyển kho cũ: sao lưu bằng SQLite backup/VACUUM INTO, chuyển qua kênh riêng tới disk khi app được dừng an toàn; không chép đè database đang dùng. Giữ nguyên bản gốc. Đặt LEGACY_OWNER_EMAIL trên hosting nếu database có dữ liệu chung chưa gắn tài khoản; chỉ email Google đã xác thực khớp cấu hình được nhận một lần.

Thiết lập sao lưu định kỳ ngoài máy chủ và thử khôi phục trước khi nhận dữ liệu quan trọng. Bản sao migration trong cùng disk không thay thế backup ngoài máy chủ.

## 5. Xác nhận bản online

- Mở `/healthz`: trả 200 và `status: ok`.
- Thử Google OAuth thật và đăng xuất.
- Dùng hai tài khoản kiểm tra dữ liệu tách biệt.
- Nhập tài liệu, xác nhận đáp án, tạo bộ, chuyển câu, luyện tập và ôn câu sai.
- Tạo một câu thử, restart/deploy rồi đăng nhập lại: câu phải còn.
- Kiểm tra trên điện thoại và xác nhận AI vẫn khóa.

Chưa đạt các bước này thì chưa gọi là đã kiểm thử production.

## 6. Cập nhật

Sửa local → `npm test` → commit → push nhánh `main`. GitHub Actions chạy kiểm thử; Render triển khai sau khi checks pass. Nếu không có CI checks, Render có thể triển khai mà không chờ test, nên giữ workflow CI bật. Branch thực tế trên Render phải trùng nhánh bạn push.

Persistent disk khiến deploy có khoảng gián đoạn. Phiên đang lưu RAM nên người dùng cần đăng nhập lại khi restart. Rollback code không tự rollback schema/dữ liệu; luôn sao lưu trước migration có thay đổi dữ liệu.

## Tài liệu chính thức

- https://render.com/docs/blueprint-spec
- https://render.com/docs/disks
- https://render.com/docs/deploys
- https://render.com/docs/free
