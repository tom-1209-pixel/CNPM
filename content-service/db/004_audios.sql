-- Âm thanh thuyết minh tạo sẵn từ chữ (mp3). Lưu trong DB vì Render gói Free không giữ file trên đĩa.
-- text_hash = md5 của contents.text lúc tạo: chữ đã sửa mà file chưa tạo lại thì hash lệch, du khách không nhận file cũ.
CREATE TABLE audios (
  poi_id     text NOT NULL,
  lang       text NOT NULL,
  text_hash  text NOT NULL,
  mp3        bytea NOT NULL,
  PRIMARY KEY (poi_id, lang),
  FOREIGN KEY (poi_id, lang) REFERENCES contents (poi_id, lang) ON DELETE CASCADE
);
