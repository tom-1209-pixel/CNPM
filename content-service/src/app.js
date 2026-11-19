import express from 'express';
import { adminGuard } from './auth.js';

const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const POI_ID = /^[A-Za-z0-9_-]{1,50}$/;
const DEFAULT_LANG = 'vi';
const text = (value, max) => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null);

// adminPassword: mật khẩu cho các đường sửa dữ liệu (trang quản lý). Để trống thì các đường đó trả 503.
export function createApp(store, { adminPassword = '' } = {}) {
  const app = express();
  app.use(express.json({ limit: '50kb' }));
  const admin = adminGuard(adminPassword);
  const adminIf = (condition) => (req, res, next) => (condition(req) ? admin(req, res, next) : next());

  // DB hỏng: trả 500 để gateway thử lại rồi coi content-service là hỏng
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: 'Không đọc hoặc ghi được dữ liệu nội dung' });
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

  // ---------- Ngôn ngữ ----------

  // Trang du khách: ngôn ngữ không ẩn. ?all=1 (trang quản lý, cần mật khẩu): mọi ngôn ngữ kèm cột hidden.
  app.get('/languages', adminIf((req) => req.query.all), handle(async (req, res) => {
    res.json(req.query.all ? await store.listAllLanguages() : await store.listLanguages());
  }));

  app.post('/languages', admin, handle(async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const name = text(req.body?.name, 50);
    if (!LANG.test(code) || !name) return res.status(400).json({ error: 'Cần mã ngôn ngữ (ví dụ zh, ko) và tên ngôn ngữ' });
    const added = await store.addLanguage(code, name);
    return added ? res.status(201).json(added) : res.status(409).json({ error: `Đã có ngôn ngữ ${code}` });
  }));

  app.put('/languages/:code', admin, handle(async (req, res) => {
    const current = (await store.listAllLanguages()).find((l) => l.code === req.params.code);
    if (!current) return res.status(404).json({ error: 'Không có ngôn ngữ này' });
    const name = req.body?.name === undefined ? current.name : text(req.body.name, 50);
    const hidden = req.body?.hidden === undefined ? current.hidden : Boolean(req.body.hidden);
    if (!name) return res.status(400).json({ error: 'Tên ngôn ngữ không được trống' });
    // Tiếng Việt là ngôn ngữ dự phòng của mọi điểm: không ẩn được.
    if (current.code === DEFAULT_LANG && hidden) return res.status(400).json({ error: 'Không ẩn được Tiếng Việt' });
    return res.json(await store.updateLanguage(current.code, { name, hidden }));
  }));

  // ---------- Nội dung ----------

  app.get('/content', handle(async (req, res) => {
    const { lang } = req.query;
    if (typeof lang !== 'string' || !lang) return res.json([]);
    return res.json(await store.listContent(lang));
  }));

  // Trang quản lý: nội dung mọi điểm, mọi ngôn ngữ.
  app.get('/content/all', admin, handle(async (req, res) => res.json(await store.listAllContent())));

  app.put('/content/:poiId/:lang', admin, handle(async (req, res) => {
    const { poiId, lang } = req.params;
    const title = text(req.body?.title, 200);
    const body = text(req.body?.text, 5000);
    if (!POI_ID.test(poiId) || !LANG.test(lang)) return res.status(400).json({ error: 'Mã điểm hoặc mã ngôn ngữ không hợp lệ' });
    if (!title || !body) return res.status(400).json({ error: 'Cần tên (tối đa 200 ký tự) và nội dung (tối đa 5000 ký tự)' });
    if (!(await store.listAllLanguages()).some((l) => l.code === lang)) return res.status(400).json({ error: `Chưa có ngôn ngữ ${lang}` });
    return res.json(await store.saveContent(poiId, lang, title, body));
  }));

  // Xóa bản của một ngôn ngữ. Không xóa riêng bản Tiếng Việt (điểm không có bản vi thì du khách không thấy).
  app.delete('/content/:poiId/:lang', admin, handle(async (req, res) => {
    if (req.params.lang === DEFAULT_LANG) return res.status(400).json({ error: 'Không xóa riêng bản Tiếng Việt; muốn bỏ điểm thì xóa điểm' });
    res.status((await store.removeContent(req.params.poiId, req.params.lang)) ? 204 : 404).end();
  }));

  // Xóa mọi bản của một điểm (khi xóa điểm ở trang quản lý).
  app.delete('/content/:poiId', admin, handle(async (req, res) => {
    await store.removeContent(req.params.poiId);
    res.status(204).end();
  }));

  return app;
}
