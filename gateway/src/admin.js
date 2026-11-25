import express from 'express';
import { getJson, sameSecret } from './http.js';

// Trang quản lý gửi mật khẩu trong header X-Admin-Password (trang thống kê cũ gửi X-Stats-Password, vẫn nhận).
// Chưa đặt mật khẩu thì từ chối hẳn, không bao giờ để mở.
export function adminGuard(adminPassword) {
  return (req, res, next) => {
    if (!adminPassword) return res.status(503).json({ error: 'Chưa đặt ADMIN_PASSWORD nên chưa vào được trang quản lý' });
    const given = req.get('X-Admin-Password') ?? req.get('X-Stats-Password') ?? '';
    if (!sameSecret(given, adminPassword)) return res.status(401).json({ error: 'Sai mật khẩu' });
    return next();
  };
}

// Các route /api/admin/*: kiểm mật khẩu rồi chuyển tiếp sang service bên dưới (gửi kèm mật khẩu của gateway,
// vì service có địa chỉ công khai nên cũng tự kiểm). Mỗi lần sửa thành công thì ghi một dòng nhật ký ở analytics-service.
export function adminRouter({ poiServiceUrl, contentServiceUrl, analyticsServiceUrl, adminPassword, timeoutMs, retryDelayMs }) {
  const router = express.Router();
  router.use(adminGuard(adminPassword), express.json({ limit: '60kb' }));

  const call = (base, path, method = 'GET', body, timeout = timeoutMs) =>
    getJson(`${base}${path}`, timeout, retryDelayMs, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Password': adminPassword },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  // Lưu nội dung kèm tạo mp3 (edge-tts mất vài giây, lần đầu có thể ~10 giây) nên chờ lâu hơn thời gian chờ thường.
  const AUDIO_TIMEOUT_MS = Math.max(timeoutMs, 60000);
  const saveContent = (poiId, lang, body) =>
    call(contentServiceUrl, `/content/${encodeURIComponent(poiId)}/${encodeURIComponent(lang)}`, 'PUT', body, AUDIO_TIMEOUT_MS);
  // Nhật ký kiểu "trả lời trước, gửi sau": analytics-service hỏng thì chỉ mất dòng nhật ký, việc sửa vẫn xong.
  const log = (action, target, detail = '') =>
    call(analyticsServiceUrl, '/changes', 'POST', { action, target, detail }).catch((err) => console.error(`nhật ký: ${err.message}`));
  const id = (req) => encodeURIComponent(req.params.id);

  // Lỗi 4xx của service (dữ liệu sai, chồng bán kính, trùng mã…): trả nguyên lý do cho trang quản lý. Còn lại: 502.
  const route = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.body?.error ?? 'Yêu cầu không hợp lệ' });
      console.error(err.message);
      return res.status(502).json({ error: 'Service bên dưới không phản hồi, thử lại sau' });
    }
  };

  // ---------- Điểm tham quan ----------

  // Mọi điểm (kể cả ẩn) ghép với nội dung mọi ngôn ngữ: [{ id, lat, lng, radius, hidden, content: { vi: {title, text} } }]
  router.get('/pois', route(async (req, res) => {
    const [pois, contents] = await Promise.all([call(poiServiceUrl, '/pois?all=1'), call(contentServiceUrl, '/content/all')]);
    res.json(pois.map((poi) => ({
      ...poi,
      content: Object.fromEntries(contents.filter((c) => c.poiId === poi.id).map((c) => [c.lang, { title: c.title, text: c.text, audio: c.audio }])),
    })));
  }));

  // Thêm điểm: tạo ở poi-service, rồi ghi nội dung từng ngôn ngữ ở content-service.
  // Bước sau lỗi thì điểm vẫn đã tạo; trả kèm contentError để trang quản lý báo và cho sửa lại.
  router.post('/pois', route(async (req, res) => {
    const { lat, lng, radius, content = {} } = req.body ?? {};
    const poi = await call(poiServiceUrl, '/pois', 'POST', { lat, lng, radius });
    let contentError = null;
    let audioError = null;
    for (const [lang, c] of Object.entries(content)) {
      try {
        const saved = await saveContent(poi.id, lang, c);
        if (saved.audioError) audioError = `${lang}: ${saved.audioError}`;
      } catch (err) {
        contentError = err.body?.error ?? 'Chưa lưu được nội dung';
      }
    }
    log('Thêm điểm', poi.id, `${content.vi?.title ?? ''} · bán kính ${poi.radius} m`.replace(/^ · /, ''));
    res.status(201).json({ ...poi, contentError, audioError });
  }));

  router.put('/pois/:id', route(async (req, res) => {
    const before = (await call(poiServiceUrl, '/pois?all=1')).find((p) => p.id === req.params.id);
    const poi = await call(poiServiceUrl, `/pois/${id(req)}`, 'PUT', req.body ?? {});
    const changed = [];
    if (before && (before.lat !== poi.lat || before.lng !== poi.lng)) changed.push('dời vị trí');
    if (before && before.radius !== poi.radius) changed.push(`bán kính ${poi.radius} m`);
    if (before && before.hidden !== poi.hidden) changed.push(poi.hidden ? 'ẩn' : 'hiện');
    if (changed.length) log(changed.length === 1 && before.hidden !== poi.hidden ? (poi.hidden ? 'Ẩn điểm' : 'Hiện điểm') : 'Sửa điểm', poi.id, changed.join(', '));
    res.json(poi);
  }));

  router.delete('/pois/:id', route(async (req, res) => {
    await call(poiServiceUrl, `/pois/${id(req)}`, 'DELETE');
    await call(contentServiceUrl, `/content/${id(req)}`, 'DELETE');
    log('Xóa điểm', req.params.id);
    res.status(204).end();
  }));

  router.post('/pois/shift', route(async (req, res) => {
    const pois = await call(poiServiceUrl, '/pois/shift', 'POST', req.body ?? {});
    log('Dời cả bộ điểm', `${pois.length} điểm`, `tâm mới ${Number(req.body.lat).toFixed(5)}, ${Number(req.body.lng).toFixed(5)}`);
    res.json(pois);
  }));

  router.put('/pois/:id/content/:lang', route(async (req, res) => {
    const saved = await saveContent(req.params.id, req.params.lang, req.body ?? {});
    log('Sửa nội dung', req.params.id, `${req.params.lang}: ${saved.title}`);
    res.json(saved);
  }));

  // Tạo lại mp3 của một nội dung (lần lưu trước edge-tts lỗi, hoặc muốn tạo lại).
  router.post('/pois/:id/content/:lang/audio', route(async (req, res) => {
    const saved = await call(contentServiceUrl, `/content/${id(req)}/${encodeURIComponent(req.params.lang)}/audio`, 'POST', undefined, AUDIO_TIMEOUT_MS);
    log('Tạo âm thanh', req.params.id, req.params.lang);
    res.json(saved);
  }));

  // Tạo mp3 cho mọi nội dung chưa có hoặc đã cũ: { created: ['poi-1/vi'], failed: [{ id, error }] }.
  router.post('/audio/rebuild', route(async (req, res) => {
    const result = await call(contentServiceUrl, '/content/audio/rebuild', 'POST', undefined, Math.max(timeoutMs, 180000));
    if (result.created.length) log('Tạo âm thanh', `${result.created.length} nội dung`, result.failed.length ? `${result.failed.length} lỗi` : '');
    res.json(result);
  }));

  router.delete('/pois/:id/content/:lang', route(async (req, res) => {
    await call(contentServiceUrl, `/content/${id(req)}/${encodeURIComponent(req.params.lang)}`, 'DELETE');
    log('Xóa nội dung', req.params.id, req.params.lang);
    res.status(204).end();
  }));

  // ---------- Ngôn ngữ ----------

  router.get('/languages', route(async (req, res) => res.json(await call(contentServiceUrl, '/languages?all=1'))));

  router.post('/languages', route(async (req, res) => {
    const added = await call(contentServiceUrl, '/languages', 'POST', req.body ?? {});
    log('Thêm ngôn ngữ', added.code, added.name);
    res.status(201).json(added);
  }));

  router.put('/languages/:code', route(async (req, res) => {
    const saved = await call(contentServiceUrl, `/languages/${encodeURIComponent(req.params.code)}`, 'PUT', req.body ?? {});
    log('Sửa ngôn ngữ', saved.code, `${saved.name}${saved.hidden ? ' (ẩn)' : ''}`);
    res.json(saved);
  }));

  // ---------- Thống kê, nhật ký, trạng thái ----------

  router.get('/stats', route(async (req, res) => {
    const range = typeof req.query.range === 'string' ? `?range=${encodeURIComponent(req.query.range)}` : '';
    res.json(await call(analyticsServiceUrl, `/stats${range}`));
  }));

  router.get('/changes', route(async (req, res) => res.json(await call(analyticsServiceUrl, '/changes'))));

  // Trạng thái từng service: gọi /health?db=1 một lần, hạn 5 giây, không thử lại (để thấy service đang ngủ).
  router.get('/status', async (req, res) => {
    const check = async (name, url) => {
      const started = Date.now();
      try {
        const r = await fetch(`${url}/health?db=1`, { signal: AbortSignal.timeout(5000) });
        const body = await r.json().catch(() => ({}));
        return { name, state: r.ok ? 'ok' : 'error', ms: Date.now() - started, db: body.db ?? null };
      } catch {
        return { name, state: 'down', ms: Date.now() - started, db: null };
      }
    };
    res.json([
      { name: 'gateway', state: 'ok', ms: 0, db: null },
      ...(await Promise.all([
        check('poi-service', poiServiceUrl),
        check('content-service', contentServiceUrl),
        check('analytics-service', analyticsServiceUrl),
      ])),
    ]);
  });

  return router;
}
