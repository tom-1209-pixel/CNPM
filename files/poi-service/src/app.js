import express from 'express';
import { adminGuard } from './auth.js';
import { findOverlap, poiError, shiftPoints } from './geo.js';

// adminPassword: mật khẩu cho các đường sửa dữ liệu (trang quản lý). Để trống thì các đường đó trả 503.
export function createApp(store, { adminPassword = '' } = {}) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  const admin = adminGuard(adminPassword);

  // DB hỏng: trả 500 để gateway thử lại rồi coi poi-service là hỏng
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: 'Không đọc hoặc ghi được dữ liệu điểm tham quan' });
    }
  };

  // Lỗi của một điểm trước khi ghi: dữ liệu sai (400) hoặc chồng bán kính với điểm khác (409). null nếu ghi được.
  const invalid = (poi, others) => {
    const error = poiError(poi);
    if (error) return { status: 400, error };
    const overlap = findOverlap(poi, others);
    return overlap ? { status: 409, error: `Chồng bán kính với điểm ${overlap.id}` } : null;
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

  // Trang du khách: điểm không ẩn. ?all=1 (trang quản lý, cần mật khẩu): mọi điểm kèm cột hidden.
  app.get('/pois', (req, res, next) => (req.query.all ? admin(req, res, next) : next()), handle(async (req, res) => {
    res.json(req.query.all ? await store.listAll() : await store.listPois());
  }));

  app.post('/pois', admin, handle(async (req, res) => {
    const { lat, lng, radius } = req.body ?? {};
    const poi = { id: null, lat, lng, radius };
    const problem = invalid(poi, await store.listAll());
    if (problem) return res.status(problem.status).json({ error: problem.error });
    return res.status(201).json(await store.create(poi));
  }));

  app.put('/pois/:id', admin, handle(async (req, res) => {
    const all = await store.listAll();
    const current = all.find((p) => p.id === req.params.id);
    if (!current) return res.status(404).json({ error: 'Không có điểm này' });
    const { lat = current.lat, lng = current.lng, radius = current.radius, hidden = current.hidden } = req.body ?? {};
    const poi = { id: current.id, lat, lng, radius, hidden: Boolean(hidden) };
    const problem = invalid(poi, all);
    if (problem) return res.status(problem.status).json({ error: problem.error });
    return res.json(await store.update(current.id, poi));
  }));

  app.delete('/pois/:id', admin, handle(async (req, res) => {
    res.status((await store.remove(req.params.id)) ? 204 : 404).end();
  }));

  // Dời cả bộ điểm để tâm của chúng về {lat, lng} (ví dụ vị trí người quản lý đang đứng).
  app.post('/pois/shift', admin, handle(async (req, res) => {
    const { lat, lng } = req.body ?? {};
    const error = poiError({ lat, lng, radius: 30 });
    if (error) return res.status(400).json({ error });
    const all = await store.listAll();
    if (all.length === 0) return res.json([]);
    return res.json(await store.moveAll(shiftPoints(all, { lat, lng })));
  }));

  return app;
}
