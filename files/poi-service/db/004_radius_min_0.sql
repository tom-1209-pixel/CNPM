-- Bỏ giới hạn bán kính tối thiểu 30 m: bán kính chỉ cần từ 0 m trở lên (người quản lý tự chọn theo khu demo).
ALTER TABLE pois DROP CONSTRAINT pois_radius_check, ADD CONSTRAINT pois_radius_check CHECK (radius >= 0);
