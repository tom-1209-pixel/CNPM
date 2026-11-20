-- Lúc du khách đóng tab hoặc rời trang (trang gửi báo "rời" ngay khi đóng). NULL: chưa báo rời.
-- Mất mạng hoặc tắt màn hình thì trang không gửi được: khi đó coi là rời sau 2 phút không còn báo "còn mở".
ALTER TABLE visits ADD COLUMN ended_at timestamptz;
