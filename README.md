# CNPM – Hệ thống thuyết minh đa ngôn ngữ cho khu tham quan ngoài trời

Đồ án môn **Công nghệ phần mềm** – Đại học Sài Gòn, Khoa Công nghệ thông tin.
Giảng viên: Nguyễn Quốc Huy.

## Nhóm thực hiện

| Họ tên | MSSV | GitHub |
|---|---|---|
| Phạm Hoàng Sang | 3124411256 | [tom-1209-pixel](https://github.com/tom-1209-pixel) |
| Võ Trần Hải Đăng | 3124411069 | [dangvotranhai-dot](https://github.com/dangvotranhai-dot) |
| Ngô Hồ Đăng Khoa | 3124411130 | [khoango6688-collab](https://github.com/khoango6688-collab) |

## Giới thiệu

Du khách quét mã QR để mở website, chọn ngôn ngữ rồi xem bản đồ có các điểm tham quan. Khi vào bán kính của một điểm, máy tự động thuyết minh bằng giọng đọc; du khách cũng có thể tự nghe, đọc, chọn điểm đến để được chỉ hướng. Người quản lý có trang riêng để sửa điểm, nội dung, ngôn ngữ và xem thống kê.

Đồ án thuộc hướng "BE Dev tạo các service giao tiếp với nhau, bao gồm CI/CD": 4 service Node.js (gateway, poi-service, content-service, analytics-service), mỗi service một cơ sở dữ liệu PostgreSQL, đóng gói Docker, kiểm thử và build tự động bằng GitHub Actions.

## Về lịch sử repo

Nhóm làm đồ án trên máy cá nhân trước khi dùng GitHub. Từ 17/11/2026, mã nguồn và tài liệu được đưa lên repo này theo từng gói, theo thứ tự làm việc, mỗi gói là một Pull Request do một thành viên tự thực hiện bằng tài khoản của mình. Ngày của commit là ngày thật thực hiện việc đưa lên.

README đầy đủ (kiến trúc, cách chạy, cách kiểm thử) sẽ được bổ sung ở một Pull Request sau.
