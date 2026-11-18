-- Dữ liệu mẫu: 2 ngôn ngữ và nội dung vi, en của 6 điểm.
INSERT INTO languages (code, name, sort_order) VALUES
  ('vi', 'Tiếng Việt', 1),
  ('en', 'English', 2);

INSERT INTO contents (poi_id, lang, title, text) VALUES
  ('poi-1', 'vi', 'Điểm 1', 'Nội dung ngắn gọn, chia thành vài câu.'),
  ('poi-1', 'en', 'Stop 1', 'Short content, split into a few sentences.'),
  ('poi-2', 'vi', 'Điểm 2', 'Nội dung ngắn gọn, chia thành vài câu.'),
  ('poi-2', 'en', 'Stop 2', 'Short content, split into a few sentences.'),
  ('poi-3', 'vi', 'Điểm 3', 'Đây là điểm thứ ba trên lộ trình. Bạn có thể dừng lại nghe giới thiệu. Sau đó đi tiếp tới điểm kế tiếp.'),
  ('poi-3', 'en', 'Stop 3', 'This is the third stop on the route. You can pause here and listen to the introduction. Then continue to the next stop.'),
  ('poi-4', 'vi', 'Điểm 4', 'Bạn đã tới điểm thứ tư. Khu vực này có nhiều cây xanh và bóng mát. Hãy nghỉ chân một lát.'),
  ('poi-4', 'en', 'Stop 4', 'You have reached the fourth stop. This area has plenty of trees and shade. Take a short rest here.'),
  ('poi-5', 'vi', 'Điểm 5', 'Điểm thứ năm nằm ở phía bắc khu tham quan. Từ đây bạn có thể nhìn bao quát toàn khu.'),
  ('poi-5', 'en', 'Stop 5', 'The fifth stop is at the northern end of the site. From here you can see the whole area.'),
  ('poi-6', 'vi', 'Điểm 6', 'Đây là điểm cuối của lộ trình mẫu. Cảm ơn bạn đã tham quan cùng chúng tôi.'),
  ('poi-6', 'en', 'Stop 6', 'This is the last stop of the sample route. Thank you for visiting with us.');
