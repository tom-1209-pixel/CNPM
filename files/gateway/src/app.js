import express from 'express';
import { fileURLToPath } from 'node:url';
import { adminGuard, adminRouter } from './admin.js';
import { getJson } from './http.js';

const DEFAULT_LANG = 'vi';
const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export function createApp({
  poiServiceUrl,
  contentServiceUrl,
  analyticsServiceUrl = 'http://localhost:3003',
  adminPassword = '',
  timeoutMs = 3000,
  retryDelayMs = 1000,
}) {
  const app = express();
  const get = (url) => getJson(url, timeoutMs, retryDelayMs);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // Địa chỉ /health của 3 service để trình duyệt tự gọi đánh thức. Trên Render gói Free, service ngủ sau ~15 phút;
  // gateway gọi thì không đánh thức được (đã đo ngày 2026-10-23), trình duyệt gọi thẳng thì dậy sau ~13 giây.
  app.get('/api/wake', (req, res) =>
    res.json({ urls: [poiServiceUrl, contentServiceUrl, analyticsServiceUrl].map((url) => `${url}/health`) }));

  app.get('/api/languages', async (req, res) => {
    try {
      res.json(await get(`${contentServiceUrl}/languages`));
    } catch (err) {
      console.error(err.message);
      res.status(502).json({ error: 'Không lấy được danh sách ngôn ngữ' });
    }
  });

  // Một service bên dưới hỏng thì vẫn trả phần lấy được từ service còn lại, kèm header X-Degraded ghi tên service hỏng,
  // để trang vẫn dùng được (content-service hỏng: còn bản đồ và chỉ đường; poi-service hỏng: còn nghe và đọc).
  // Chỉ trả 502 khi cả hai cùng hỏng.
  app.get('/api/pois', async (req, res) => {
    const lang = typeof req.query.lang === 'string' && req.query.lang ? req.query.lang : DEFAULT_LANG;
    const [poisResult, contentResult] = await Promise.allSettled([
      get(`${poiServiceUrl}/pois`),
      Promise.all([
        get(`${contentServiceUrl}/content?lang=${encodeURIComponent(lang)}`),
        lang === DEFAULT_LANG ? Promise.resolve([]) : get(`${contentServiceUrl}/content?lang=${DEFAULT_LANG}`),
      ]),
    ]);
    for (const result of [poisResult, contentResult]) {
      if (result.status === 'rejected') console.error(result.reason.message);
    }

    if (poisResult.status === 'rejected' && contentResult.status === 'rejected') {
      res.status(502).json({ error: 'Không lấy được dữ liệu điểm tham quan' });
      return;
    }
    if (contentResult.status === 'rejected') {
      res.set('X-Degraded', 'content-service').json(poisResult.value);
      return;
    }

    const [wanted, fallback] = contentResult.value;
    const wantedById = new Map(wanted.map((c) => [c.poiId, c]));
    const fallbackById = new Map(fallback.map((c) => [c.poiId, c]));
    const contentFor = (id) => wantedById.get(id) ?? fallbackById.get(id);

    if (poisResult.status === 'rejected') {
      // không có tọa độ: liệt kê các POI có bản vi (cùng quy tắc bỏ POI thiếu vi như khi ghép đủ)
      const viContent = lang === DEFAULT_LANG ? wanted : fallback;
      const items = viContent.map((c) => ({ id: c.poiId, title: contentFor(c.poiId).title, text: contentFor(c.poiId).text }));
      res.set('X-Degraded', 'poi-service').json(items);
      return;
    }

    const merged = [];
    for (const poi of poisResult.value) {
      const content = contentFor(poi.id);
      if (content) merged.push({ ...poi, title: content.title, text: content.text });
    }
    res.json(merged);
  });

  // Thống kê lượt truy cập: trả 202 ngay rồi mới chuyển tiếp sang analytics-service ở phía sau,
  // để analytics-service chậm hay hỏng cũng không làm trang du khách chờ hoặc báo lỗi (chỉ mất số liệu, có ghi log).
  const forward = (path, body) =>
    getJson(`${analyticsServiceUrl}${path}`, timeoutMs, retryDelayMs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }).catch((err) => console.error(`thống kê: ${err.message}`));
  const smallJson = express.json({ limit: '1kb' });

  app.post('/api/visits', smallJson, (req, res) => {
    forward('/visits', req.body);
    res.status(202).end();
  });

  app.post('/api/visits/:id/ping', smallJson, (req, res) => {
    forward(`/visits/${encodeURIComponent(req.params.id)}/ping`, req.body);
    res.status(202).end();
  });

  // Trang gửi bằng navigator.sendBeacon khi du khách đóng tab hoặc rời trang (không có nội dung).
  app.post('/api/visits/:id/leave', (req, res) => {
    forward(`/visits/${encodeURIComponent(req.params.id)}/leave`, {});
    res.status(202).end();
  });

  // Du khách mở thẻ hoặc nghe một điểm: dùng cho thống kê theo điểm (cùng kiểu "trả 202 rồi gửi sau").
  app.post('/api/events', smallJson, (req, res) => {
    forward('/events', req.body);
    res.status(202).end();
  });

  // Trang quản lý (điểm, ngôn ngữ, thống kê, nhật ký, trạng thái hệ thống), cần mật khẩu.
  const admin = { poiServiceUrl, contentServiceUrl, analyticsServiceUrl, adminPassword, timeoutMs, retryDelayMs };
  app.use('/api/admin', adminRouter(admin));

  // Đường cũ của trang thống kê (trước khi gộp vào trang quản lý): vẫn giữ, gửi mật khẩu kèm theo.
  app.get('/api/stats', adminGuard(adminPassword), async (req, res) => {
    try {
      const range = typeof req.query.range === 'string' ? `?range=${encodeURIComponent(req.query.range)}` : '';
      const headers = { 'X-Admin-Password': adminPassword };
      return res.json(await getJson(`${analyticsServiceUrl}/stats${range}`, timeoutMs, retryDelayMs, { headers }));
    } catch (err) {
      console.error(err.message);
      return res.status(502).json({ error: 'Không lấy được số liệu thống kê' });
    }
  });

  app.use(express.static(publicDir));
  return app;
}
