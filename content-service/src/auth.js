import { createHash, timingSafeEqual } from 'node:crypto';

// So mật khẩu không để lộ độ dài hay vị trí ký tự sai qua thời gian phản hồi.
export const sameSecret = (a, b) => {
  const hash = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(hash(a), hash(b));
};

// Chặn các đường sửa dữ liệu: service có địa chỉ công khai (Render gói Free), nên luôn đòi mật khẩu quản lý.
// Chưa đặt mật khẩu thì từ chối hẳn (503), không bao giờ để mở.
export function adminGuard(password) {
  return (req, res, next) => {
    if (!password) return res.status(503).json({ error: 'Chưa đặt ADMIN_PASSWORD nên chưa sửa được dữ liệu' });
    const given = req.get('X-Admin-Password') ?? req.get('X-Stats-Password') ?? '';
    if (!sameSecret(given, password)) return res.status(401).json({ error: 'Sai mật khẩu' });
    return next();
  };
}
