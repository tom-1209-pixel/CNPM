CREATE TABLE languages (
  code        text PRIMARY KEY,
  name        text NOT NULL,   -- viết bằng chính ngôn ngữ đó (Tiếng Việt, English)
  sort_order  integer NOT NULL -- thứ tự trên màn chọn ngôn ngữ
);

CREATE TABLE contents (
  -- id của điểm bên poi-service. Hai service dùng hai DB riêng nên không đặt được khóa ngoại;
  -- test dữ liệu ở gateway kiểm tra mỗi nội dung trỏ tới một điểm có thật.
  poi_id  text NOT NULL,
  lang    text NOT NULL REFERENCES languages (code),
  title   text NOT NULL,
  text    text NOT NULL,
  PRIMARY KEY (poi_id, lang)
);
