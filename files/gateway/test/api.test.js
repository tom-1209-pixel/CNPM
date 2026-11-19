import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../src/app.js';

const pois = [
  { id: 'poi-1', lat: 10.1, lng: 106.1, radius: 30 },
  { id: 'poi-2', lat: 10.2, lng: 106.2, radius: 30 },
  { id: 'poi-3', lat: 10.3, lng: 106.3, radius: 30 },
];
const content = [
  { poiId: 'poi-1', lang: 'vi', title: 'Điểm 1', text: 'Nội dung 1.' },
  { poiId: 'poi-1', lang: 'en', title: 'Stop 1', text: 'Content 1.' },
  { poiId: 'poi-2', lang: 'vi', title: 'Điểm 2', text: 'Nội dung 2.' },
];
const languages = [{ code: 'vi', name: 'Tiếng Việt' }, { code: 'en', name: 'English' }];

const servers = [];
function listen(app) {
  const server = app.listen(0);
  servers.push(server);
  return `http://localhost:${server.address().port}`;
}

let base;
before(() => {
  const poiApp = express();
  poiApp.get('/pois', (req, res) => res.json(pois));
  const contentApp = express();
  contentApp.get('/languages', (req, res) => res.json(languages));
  contentApp.get('/content', (req, res) => res.json(content.filter((c) => c.lang === req.query.lang)));
  base = listen(createApp({ poiServiceUrl: listen(poiApp), contentServiceUrl: listen(contentApp) }));
});
after(() => servers.forEach((s) => s.close()));

const getPois = async (query = '') => (await fetch(`${base}/api/pois${query}`)).json();

test('GET /api/health trả status ok', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('GET /api/wake trả địa chỉ /health của 3 service để trình duyệt đánh thức', async () => {
  const app = listen(createApp({ poiServiceUrl: 'https://poi.example', contentServiceUrl: 'https://content.example', analyticsServiceUrl: 'https://analytics.example' }));
  assert.deepEqual(await (await fetch(`${app}/api/wake`)).json(), {
    urls: ['https://poi.example/health', 'https://content.example/health', 'https://analytics.example/health'],
  });
});

test('GET /api/languages chuyển tiếp danh sách ngôn ngữ', async () => {
  const res = await fetch(`${base}/api/languages`);
  assert.deepEqual(await res.json(), languages);
});

test('GET /api/pois?lang=vi ghép tọa độ và nội dung', async () => {
  assert.deepEqual(await getPois('?lang=vi'), [
    { ...pois[0], title: 'Điểm 1', text: 'Nội dung 1.' },
    { ...pois[1], title: 'Điểm 2', text: 'Nội dung 2.' },
  ]);
});

test('lang=en: POI thiếu bản en thì lấy bản vi của chính POI đó', async () => {
  const result = await getPois('?lang=en');
  assert.equal(result[0].title, 'Stop 1');
  assert.equal(result[1].title, 'Điểm 2');
});

test('POI không có cả bản vi thì bị bỏ khỏi kết quả', async () => {
  const result = await getPois('?lang=en');
  assert.equal(result.length, 2);
  assert.ok(!result.some((p) => p.id === 'poi-3'));
});

test('lang không hợp lệ hoặc thiếu thì dùng vi', async () => {
  for (const q of ['?lang=xx', '']) {
    const result = await getPois(q);
    assert.equal(result[0].title, 'Điểm 1');
  }
});

// địa chỉ của một server vừa đóng: gọi tới là lỗi kết nối
function deadUrl() {
  const url = listen(express());
  servers.pop().close();
  return url;
}

function contentApp() {
  const app = express();
  app.get('/content', (req, res) => res.json(content.filter((c) => c.lang === req.query.lang)));
  return app;
}

test('content-service hỏng: vẫn trả tọa độ các POI, không có nội dung, kèm X-Degraded', async () => {
  const poiApp = express();
  poiApp.get('/pois', (req, res) => res.json(pois));
  const app = listen(createApp({ poiServiceUrl: listen(poiApp), contentServiceUrl: deadUrl(), timeoutMs: 300, retryDelayMs: 50 }));
  const res = await fetch(`${app}/api/pois?lang=vi`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-degraded'), 'content-service');
  assert.deepEqual(await res.json(), pois);
});

test('poi-service hỏng: vẫn trả nội dung các POI có bản vi, không có tọa độ, kèm X-Degraded', async () => {
  const app = listen(createApp({ poiServiceUrl: deadUrl(), contentServiceUrl: listen(contentApp()), timeoutMs: 300, retryDelayMs: 50 }));
  const res = await fetch(`${app}/api/pois?lang=en`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-degraded'), 'poi-service');
  assert.deepEqual(await res.json(), [
    { id: 'poi-1', title: 'Stop 1', text: 'Content 1.' },
    { id: 'poi-2', title: 'Điểm 2', text: 'Nội dung 2.' },
  ]);
});

test('đủ hai service thì không có header X-Degraded', async () => {
  const res = await fetch(`${base}/api/pois?lang=vi`);
  assert.equal(res.headers.get('x-degraded'), null);
});

test('cả hai service bên dưới không phản hồi thì trả 502', async () => {
  const dead = deadUrl();
  const app = listen(createApp({ poiServiceUrl: dead, contentServiceUrl: dead, timeoutMs: 500 }));
  for (const path of ['/api/pois', '/api/languages']) {
    const res = await fetch(`${app}${path}`);
    assert.equal(res.status, 502);
    assert.equal(typeof (await res.json()).error, 'string');
  }
});

test('cả hai service trả lỗi 500 suốt thời gian chờ thì gateway trả 502', async () => {
  const broken = express();
  broken.use((req, res) => res.status(500).end());
  const brokenUrl = listen(broken);
  const app = listen(createApp({ poiServiceUrl: brokenUrl, contentServiceUrl: brokenUrl, timeoutMs: 300, retryDelayMs: 50 }));
  assert.equal((await fetch(`${app}/api/pois`)).status, 502);
});

test('service bên dưới lỗi lúc đang thức dậy rồi chạy lại thì gateway đợi và trả 200', async () => {
  let calls = 0;
  const waking = express();
  waking.get('/pois', (req, res) => (++calls <= 2 ? res.status(503).end() : res.json(pois)));
  const app = listen(
    createApp({ poiServiceUrl: listen(waking), contentServiceUrl: listen(contentApp()), timeoutMs: 3000, retryDelayMs: 20 }),
  );
  const res = await fetch(`${app}/api/pois?lang=vi`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).length, 2);
  assert.equal(calls, 3);
});

test('cả hai service trả lỗi 4xx thì không thử lại, trả 502 ngay', async () => {
  const notFound = express();
  notFound.use((req, res) => res.status(404).end());
  const url = listen(notFound);
  const app = listen(createApp({ poiServiceUrl: url, contentServiceUrl: url, timeoutMs: 5000, retryDelayMs: 1000 }));
  const startedAt = Date.now();
  assert.equal((await fetch(`${app}/api/pois`)).status, 502);
  assert.ok(Date.now() - startedAt < 900, 'không được chờ thử lại');
});

// ---------- Thống kê lượt truy cập ----------

const VISIT_ID = '0b6f2c3e-8d7a-4f1e-9c2b-5a4d3e2f1a0b';
const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

function fakeAnalytics() {
  const received = [];
  const app = express();
  app.use(express.json());
  app.post('/visits', (req, res) => {
    received.push({ path: req.path, body: req.body });
    res.status(201).end();
  });
  app.post('/visits/:id/ping', (req, res) => {
    received.push({ path: req.path, body: req.body });
    res.status(204).end();
  });
  app.post('/visits/:id/leave', (req, res) => {
    received.push({ path: req.path, body: req.body });
    res.status(204).end();
  });
  app.get('/stats', (req, res) =>
    req.get('X-Admin-Password') === 'bi-mat' ? res.json({ online: 3, range: req.query.range ?? null }) : res.status(401).end());
  return { url: listen(app), received };
}

test('POST /api/visits và /ping trả 202 rồi chuyển tiếp sang analytics-service', async () => {
  const analytics = fakeAnalytics();
  const app = listen(createApp({ poiServiceUrl: deadUrl(), contentServiceUrl: deadUrl(), analyticsServiceUrl: analytics.url }));
  const post = (path, body) => fetch(`${app}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/visits', { id: VISIT_ID, lang: 'vi' })).status, 202);
  assert.equal((await post(`/api/visits/${VISIT_ID}/ping`, { lang: 'en' })).status, 202);
  // sendBeacon không gửi JSON
  assert.equal((await fetch(`${app}/api/visits/${VISIT_ID}/leave`, { method: 'POST' })).status, 202);
  await until(() => analytics.received.length === 3);
  // gửi song song nên có thể tới lệch thứ tự
  const byPath = (x, y) => x.path.localeCompare(y.path);
  assert.deepEqual([...analytics.received].sort(byPath), [
    { path: '/visits', body: { id: VISIT_ID, lang: 'vi' } },
    { path: `/visits/${VISIT_ID}/ping`, body: { lang: 'en' } },
    { path: `/visits/${VISIT_ID}/leave`, body: {} },
  ].sort(byPath));
});

test('analytics-service hỏng thì POST /api/visits vẫn trả 202 ngay, không chờ', async () => {
  const app = listen(createApp({ poiServiceUrl: deadUrl(), contentServiceUrl: deadUrl(), analyticsServiceUrl: deadUrl(), timeoutMs: 300, retryDelayMs: 50 }));
  const startedAt = Date.now();
  const res = await fetch(`${app}/api/visits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: VISIT_ID, lang: 'vi' }) });
  assert.equal(res.status, 202);
  assert.ok(Date.now() - startedAt < 250, 'không được chờ analytics-service');
});

test('GET /api/stats: chưa đặt mật khẩu thì 503, sai mật khẩu thì 401, đúng thì trả số liệu', async () => {
  const analytics = fakeAnalytics();
  const noPassword = listen(createApp({ poiServiceUrl: deadUrl(), contentServiceUrl: deadUrl(), analyticsServiceUrl: analytics.url }));
  assert.equal((await fetch(`${noPassword}/api/stats`, { headers: { 'X-Stats-Password': '' } })).status, 503);

  const app = listen(createApp({ poiServiceUrl: deadUrl(), contentServiceUrl: deadUrl(), analyticsServiceUrl: analytics.url, adminPassword: 'bi-mat' }));
  assert.equal((await fetch(`${app}/api/stats`)).status, 401);
  assert.equal((await fetch(`${app}/api/stats`, { headers: { 'X-Stats-Password': 'sai' } })).status, 401);
  const ok = await fetch(`${app}/api/stats?range=7d`, { headers: { 'X-Stats-Password': 'bi-mat' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { online: 3, range: '7d' });
});

test('GET /api/stats: analytics-service hỏng thì 502', async () => {
  const app = listen(createApp({ poiServiceUrl: deadUrl(), contentServiceUrl: deadUrl(), analyticsServiceUrl: deadUrl(), adminPassword: 'x', timeoutMs: 300, retryDelayMs: 50 }));
  assert.equal((await fetch(`${app}/api/stats`, { headers: { 'X-Stats-Password': 'x' } })).status, 502);
});
