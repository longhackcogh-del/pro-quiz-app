# Hiệu năng với bộ câu hỏi lớn

## Nguyên nhân đã sửa

- Tải kho gọi getQuestion cho từng bản ghi, mỗi câu thêm hai truy vấn. Bài luyện tập và xuất kho cũng lặp lại cách này.
- Thống kê duyệt cả câu chưa trả lời trong mọi bài đang làm; dashboard còn tải thống kê hai lần từ frontend.
- Import ghi và đọc lại từng câu/lựa chọn qua mạng trong transaction.
- Mỗi lần chọn đáp án gửi lại toàn bộ bài làm, dù giao diện chỉ cần câu vừa trả lời và câu đang hiển thị.
- Preview dựng tất cả form câu hỏi cùng lúc; collectPreview tìm DOM cho từng câu.

## Thay đổi

- Luyện tập dùng `feedbackOnly=true`: một request lưu đáp án cùng vị trí câu tiếp theo, hai truy vấn SQL, phản hồi khoảng 180 byte. Giao diện đánh dấu lựa chọn ngay; chỉ hiển thị đúng/sai sau xác nhận của server. Chuyển câu sau 350 ms (đúng) hoặc 650 ms (sai), có nút chuyển ngay.
- Không tải lịch sử chat mỗi câu khi Giáo viên AI đang khóa. Chống nhấn đáp án/nộp bài lặp và phát hiện xung đột ghi từ hai tab; lỗi mạng không hiển thị kết quả chấm giả.
- Xác nhận và xóa nhiều câu gọi API theo lô, kiểm tra quyền sở hữu toàn bộ trước khi ghi. Với 5.000 câu, xác nhận dùng 8 truy vấn; xóa 3.000 câu dùng 4 truy vấn.
- JOIN câu hỏi/lựa chọn theo chủ tài khoản; truy vấn nhóm ID tối đa 2.000 tham số câu hỏi mỗi lần.
- Bỏ truy vấn cho câu chưa trả lời khi tính câu sai. Gộp truy vấn dashboard ở frontend.
- Ghi câu hỏi theo lô 500, ghi câu sai theo lô 1.000, giữ transaction cho cả lần nhập.
- API answer hỗ trợ compact=true: trả metadata và tối đa hai câu, frontend ghép vào bài đã tải. Client cũ không gửi compact vẫn nhận đầy đủ như trước.
- Preview 25 câu/trang, thu thập các ô đang hiển thị một lần, giữ bản nháp ở các trang khác.
- Cache văn bản tìm kiếm theo object câu hỏi; không chuẩn hóa lại toàn bộ options khi không có từ khóa.
- Không upsert users trong transaction ở mọi request sau khi danh tính đã được ghi nhận trong process; việc xác thực session và kiểm tra owner vẫn thực hiện mỗi request.
- JSON import tối đa 10 MB, tương ứng giới hạn upload hiện có. Payload vượt mức trả 413 có thông báo, không báo lỗi chung.

## Kiểm thử

`tests/large-bank.test.js`: 5.000 câu qua HTTP, SQLite tạm, thêm 1 ms chờ cho mỗi lời gọi truy vấn để phát hiện N+1.

- Import: 20 câu lệnh SQL.
- Tải kho: 1 câu lệnh SQL.
- Dashboard với bài 5.000 câu chưa trả lời: 6 câu lệnh SQL.
- Answer compact: khoảng 0,6 KB; chỉ có đáp án câu đã trả lời, không lộ đáp án câu tiếp theo.
- Kiểm tra gắn lựa chọn/ID, chấm điểm, câu sai và phân quyền tài khoản.

Browser test dựng preview 5.000 câu, xác nhận chỉ 25 form xuất hiện, sửa nội dung/chọn đáp án rồi chuyển trang không mất bản nháp.

Browser test cũng mô phỏng phản hồi chậm, mất mạng, nhấn nộp hai lần và xác nhận một request cho mỗi đáp án, không đọc chat khi khóa. `tests/practice-flow.test.js` kiểm tra vị trí tiếp tục, chấm điểm phía server và hai tab ghi đồng thời; `tests/bulk-actions.test.js` kiểm tra phân quyền cho thao tác theo lô.

PostgreSQL integration test nhập 501 câu để vượt ranh giới một lô, kiểm tra options/ID, tạo bài và phản hồi compact. CI dùng PostgreSQL 17 riêng; lần thử với tài khoản fixture trên Neon thật ngày 12/11/2026 đo bulk import khoảng 609 ms từ máy phát triển. Các fixture được dọn theo đúng owner test.

Đây không phải kết quả đo tải nhiều người hoặc thời gian phản hồi bảo đảm trên Render. Render Free/Neon có thể khởi động chậm sau thời gian ngủ; tối ưu truy vấn không loại bỏ cold start. Lần tải kho hoặc mở bài đầu tiên vẫn gửi toàn bộ dữ liệu tương ứng; bộ lớn hơn nhiều cần đo thêm và cân nhắc phân trang API. Không thay gói hosting hoặc thêm quota trong thay đổi này.
