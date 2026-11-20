import express from 'express';
import { adminGuard } from './auth.js';
import { RANGES } from './store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const POI_ID = /^[A-Za-z0-9_-]{1,50}$/;
const short = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

// adminPassword: trên Render service này có địa chỉ công khai (gói Free không có mạng nội bộ), nên số liệu và
// nhật ký đòi mật khẩu quản lý; gateway chuyển tiếp header. Để trống thì các đường đó trả 503.
export function createApp(store, { adminPassword = '' } = {}) {
  const app = express();
  app.use(express.json({ limit: '2kb' }));
  const admin = adminGuard(adminPassword);

  // DB hỏng: trả 500; gateway chỉ ghi log, trang du khách không bị ảnh hưởng.
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: 'Không ghi hoặc đọc được dữ liệu thống kê' });
    }
  };

  // ?db=1: thử đọc DB, để trang quản lý biết DB còn dùng được không.
  app.get('/health', handle(async (req, res) => {
    if (req.query.db === undefined) return res.json({ status: 'ok' });
    try {
      await store.checkDb();
      return res.json({ status: 'ok', db: 'ok' });
    } catch (err) {
      return res.json({ status: 'ok', db: 'error', error: err.message });
    }
  }));

  app.post('/visits', handle(async (req, res) => {
    const { id, lang } = req.body ?? {};
    if (typeof id !== 'string' || !UUID.test(id) || typeof lang !== 'string' || !LANG.test(lang)) {
      return res.status(400).json({ error: 'id phải là UUID, lang là mã ngôn ngữ' });
    }
    await store.recordVisit(id, lang);
    return res.status(201).end();
  }));

  app.post('/visits/:id/ping', handle(async (req, res) => {
    const { lang } = req.body ?? {};
    if (!UUID.test(req.params.id) || (lang !== undefined && (typeof lang !== 'string' || !LANG.test(lang)))) {
      return res.status(400).json({ error: 'id phải là UUID, lang là mã ngôn ngữ' });
    }
    const found = await store.ping(req.params.id, lang);
    return res.status(found ? 204 : 404).end();
  }));

  // Trang báo "rời" khi du khách đóng tab hoặc rời trang.
  app.post('/visits/:id/leave', handle(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'id phải là UUID' });
    const found = await store.leave(req.params.id);
    return res.status(found ? 204 : 404).end();
  }));

  // Du khách mở thẻ (open) hoặc nghe (play) một điểm: dùng cho thống kê theo điểm.
  app.post('/events', handle(async (req, res) => {
    const { visitId, poiId, kind } = req.body ?? {};
    if (typeof visitId !== 'string' || !UUID.test(visitId) || typeof poiId !== 'string' || !POI_ID.test(poiId) || !['open', 'play'].includes(kind)) {
      return res.status(400).json({ error: 'Cần visitId (UUID), poiId và kind là open hoặc play' });
    }
    await store.recordEvent(visitId, poiId, kind);
    return res.status(201).end();
  }));

  // Nhật ký thay đổi của trang quản lý (gateway gửi sau mỗi lần sửa thành công).
  app.post('/changes', admin, handle(async (req, res) => {
    const action = short(req.body?.action, 50);
    const target = short(req.body?.target, 100);
    if (!action || !target) return res.status(400).json({ error: 'Cần action và target' });
    return res.status(201).json(await store.recordChange(action, target, short(req.body?.detail, 500) ?? ''));
  }));

  app.get('/changes', admin, handle(async (req, res) => res.json(await store.listChanges())));

  // range: khoảng thời gian của danh sách lượt (1h, today, 7d, 30d), mặc định today.
  app.get('/stats', admin, handle(async (req, res) => {
    const range = req.query.range ?? 'today';
    if (!Object.hasOwn(RANGES, range)) return res.status(400).json({ error: `range phải là ${Object.keys(RANGES).join(', ')}` });
    return res.json(await store.stats(range));
  }));

  return app;
}
