-- Thống kê theo điểm: mỗi lần du khách mở thẻ (open) hoặc nghe (play) một điểm. Vẫn ẩn danh: chỉ có mã lượt.
CREATE TABLE poi_events (
  id        bigserial PRIMARY KEY,
  visit_id  uuid NOT NULL,
  poi_id    text NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('open', 'play')),
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX poi_events_at_idx ON poi_events (at);

-- Nhật ký thay đổi của trang quản lý: thêm, sửa, xóa, ẩn, dời điểm; sửa ngôn ngữ, nội dung.
CREATE TABLE changes (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  action  text NOT NULL,
  target  text NOT NULL,
  detail  text NOT NULL DEFAULT ''
);
CREATE INDEX changes_at_idx ON changes (at);
