-- Một dòng cho mỗi lượt mở trang. Ẩn danh: id là mã ngẫu nhiên trang tự tạo, chỉ nằm trong bộ nhớ trang
-- (tải lại trang là lượt mới); không lưu IP, trình duyệt hay vị trí.
CREATE TABLE visits (
  id            uuid PRIMARY KEY,
  lang          text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now() -- trang báo "còn mở" mỗi 30 giây
);

CREATE INDEX visits_started_at_idx ON visits (started_at);
CREATE INDEX visits_last_seen_at_idx ON visits (last_seen_at);
