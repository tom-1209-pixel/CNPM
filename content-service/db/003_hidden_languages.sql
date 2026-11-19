-- Ngôn ngữ ẩn: chưa hiện cho du khách (ví dụ đang nhập dở nội dung), trang quản lý vẫn thấy và sửa được.
ALTER TABLE languages ADD COLUMN hidden boolean NOT NULL DEFAULT false;
