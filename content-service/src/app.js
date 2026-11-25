import express from 'express';
import { adminGuard } from './auth.js';
import { textHash } from './tts.js';

const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const POI_ID = /^[A-Za-z0-9_-]{1,50}$/;
const DEFAULT_LANG = 'vi';
const text = (value, max) => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null);

// adminPassword: mật khẩu cho các đường sửa dữ liệu (trang quản lý). Để trống thì các đường đó trả 503.
// tts: { hasVoice(lang), synthesize(text, lang) } tạo mp3 từ chữ; không truyền thì không tạo âm thanh (test, máy dev).
export function createApp(store, { adminPassword = '', tts = null } = {}) {
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

  // Tạo mp3 từ chữ hiện tại của một nội dung rồi ghi vào DB. Lỗi thì ném ra cho nơi gọi quyết định.
  async function makeAudio({ poiId, lang, text: body }) {
    await store.saveAudio(poiId, lang, textHash(body), await tts.synthesize(body, lang));
  }

  // Trang du khách: file mp3 của một điểm ở một ngôn ngữ (chỉ khi còn khớp chữ hiện tại).
  app.get('/content/:poiId/:lang/audio', handle(async (req, res) => {
    const audio = await store.getAudio(req.params.poiId, req.params.lang);
    if (!audio) return res.status(404).json({ error: 'Chưa có âm thanh' });
    // no-cache + ETag theo hash chữ: máy du khách luôn hỏi lại, file chưa đổi thì nhận 304 (không tải lại).
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache', ETag: `"${audio.textHash}"` });
    if (req.get('If-None-Match') === `"${audio.textHash}"`) return res.status(304).end();
    return res.send(audio.mp3);
  }));

  // Trang quản lý: tạo mp3 cho mọi nội dung chưa có hoặc đã cũ (nội dung mẫu, hoặc lần trước edge-tts lỗi).
  app.post('/content/audio/rebuild', admin, handle(async (req, res) => {
    if (!tts) return res.status(503).json({ error: 'Chưa bật tạo âm thanh' });
    const created = [];
    const failed = [];
    for (const item of await store.listMissingAudio()) {
      const id = `${item.poiId}/${item.lang}`;
      if (!tts.hasVoice(item.lang)) {
        failed.push({ id, error: `Chưa có giọng đọc cho ngôn ngữ ${item.lang}` });
        continue;
      }
      try {
        await makeAudio(item);
        created.push(id);
      } catch (err) {
        console.error(`Tạo âm thanh ${id}: ${err.message}`);
        failed.push({ id, error: err.message });
      }
    }
    return res.json({ created, failed });
  }));

  // Tạo lại mp3 của một nội dung. Lỗi dịch vụ giọng đọc thì 502 kèm lý do.
  app.post('/content/:poiId/:lang/audio', admin, handle(async (req, res) => {
    if (!tts) return res.status(503).json({ error: 'Chưa bật tạo âm thanh' });
    const item = await store.getContent(req.params.poiId, req.params.lang);
    if (!item) return res.status(404).json({ error: 'Không có nội dung này' });
    try {
      await makeAudio(item);
    } catch (err) {
      console.error(`Tạo âm thanh ${req.params.poiId}/${req.params.lang}: ${err.message}`);
      return res.status(502).json({ error: `Không tạo được âm thanh: ${err.message}` });
    }
    return res.json({ ...item, audio: true });
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
    const saved = await store.saveContent(poiId, lang, title, body);
    if (!tts) return res.json(saved);
    // Chỉ đổi tên (nội dung giữ nguyên) thì mp3 cũ vẫn khớp: không gọi edge-tts lại.
    if (await store.getAudio(poiId, lang)) return res.json({ ...saved, audio: true });
    // Chữ đã lưu thì vẫn giữ dù tạo âm thanh lỗi: trả audioError để trang quản lý báo và cho tạo lại.
    try {
      await makeAudio(saved);
      return res.json({ ...saved, audio: true });
    } catch (err) {
      console.error(`Tạo âm thanh ${poiId}/${lang}: ${err.message}`);
      return res.json({ ...saved, audio: false, audioError: err.message });
    }
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
