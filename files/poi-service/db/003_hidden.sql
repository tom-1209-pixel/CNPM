-- Điểm ẩn: trang quản lý tạm ẩn khỏi trang du khách mà không xóa (ví dụ khu đang sửa chữa).
ALTER TABLE pois ADD COLUMN hidden boolean NOT NULL DEFAULT false;
