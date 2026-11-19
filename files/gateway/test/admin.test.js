import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../src/app.js';

// 3 service giả trong bộ nhớ, kiểm mật khẩu gateway gửi kèm như service thật.
const PASSWORD = 'quanly';
let pois;
let contents;
let languages;
let changes;
const servers = [];
const listen = (app) => {
  const server = app.listen(0);
  servers.push(server);
  return `http://localhost:${server.address().port}`;
};
// /health công khai (như service thật), các đường còn lại đòi mật khẩu.
const guarded = () => {
  const app = express();
  app.use(express.json());
  app.get('/health', (req, res) => res.json({ status: 'ok', db: 'ok' }));
  app.use((req, res, next) => (req.get('X-Admin-Password') === PASSWORD ? next() : res.status(401).json({ error: 'Sai mật khẩu' })));
  return app;
};

function poiApp() {
  const app = guarded();
  app.get('/pois', (req, res) => res.json(pois));
  app.post('/pois', (req, res) => {
    if (req.body.radius < 0) return res.status(400).json({ error: 'Bán kính phải là số nguyên từ 0 m trở lên' });
    const poi = { id: `poi-${pois.length + 1}`, ...req.body, hidden: false };
    pois.push(poi);
    return res.status(201).json(poi);
  });
  app.put('/pois/:id', (req, res) => res.json(Object.assign(pois.find((p) => p.id === req.params.id), req.body)));
  app.delete('/pois/:id', (req, res) => {
    pois = pois.filter((p) => p.id !== req.params.id);
    res.status(204).end();
  });
  app.post('/pois/shift', (req, res) => res.json(pois));
  return app;
}
function contentApp() {
  const app = guarded();
  app.get('/content/all', (req, res) => res.json(contents));
  app.put('/content/:poiId/:lang', (req, res) => {
    const item = { poiId: req.params.poiId, lang: req.params.lang, ...req.body };
    contents = contents.filter((c) => !(c.poiId === item.poiId && c.lang === item.lang)).concat(item);
    res.json(item);
  });
  app.delete('/content/:poiId', (req, res) => {
    contents = contents.filter((c) => c.poiId !== req.params.poiId);
    res.status(204).end();
  });
  app.get('/languages', (req, res) => res.json(languages));
  app.post('/languages', (req, res) => {
    if (languages.some((l) => l.code === req.body.code)) return res.status(409).json({ error: `Đã có ngôn ngữ ${req.body.code}` });
    languages.push({ ...req.body, hidden: false });
    return res.status(201).json({ ...req.body, hidden: false });
  });
  return app;
}
function analyticsApp() {
  const app = guarded();
  app.get('/stats', (req, res) => res.json({ online: 2, range: req.query.range ?? null }));
  app.post('/changes', (req, res) => {
    changes.push(req.body);
    res.status(201).json(req.body);
  });
  app.get('/changes', (req, res) => res.json(changes));
  return app;
}

let base;
let deadUrl;
before(() => {
  const services = { poiServiceUrl: listen(poiApp()), contentServiceUrl: listen(contentApp()), analyticsServiceUrl: listen(analyticsApp()) };
  base = listen(createApp({ ...services, adminPassword: PASSWORD }));
  deadUrl = listen(express());
  servers.pop().close();
});
beforeEach(() => {
  pois = [{ id: 'poi-1', lat: 10.7769, lng: 106.7009, radius: 30, hidden: false }];
  contents = [
    { poiId: 'poi-1', lang: 'vi', title: 'Điểm 1', text: 'Nội dung.' },
    { poiId: 'poi-1', lang: 'en', title: 'Stop 1', text: 'Content.' },
  ];
  languages = [{ code: 'vi', name: 'Tiếng Việt', hidden: false }];
  changes = [];
});
after(() => servers.forEach((s) => s.close()));

const send = (method, path, body, password = PASSWORD) =>
  fetch(`${base}/api/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(password && { 'X-Admin-Password': password }) },
    body: body && JSON.stringify(body),
  });
const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

test('/api/admin/*: thiếu hoặc sai mật khẩu thì 401; gateway chưa đặt mật khẩu thì 503', async () => {
  assert.equal((await send('GET', '/pois', null, '')).status, 401);
  assert.equal((await send('GET', '/pois', null, 'sai')).status, 401);
  const open = listen(createApp({ poiServiceUrl: deadUrl, contentServiceUrl: deadUrl }));
  assert.equal((await fetch(`${open}/api/admin/pois`, { headers: { 'X-Admin-Password': PASSWORD } })).status, 503);
});

test('GET /api/admin/pois ghép điểm với nội dung mọi ngôn ngữ', async () => {
  assert.deepEqual(await (await send('GET', '/pois')).json(), [
    { ...pois[0], content: { vi: { title: 'Điểm 1', text: 'Nội dung.' }, en: { title: 'Stop 1', text: 'Content.' } } },
  ]);
});

test('POST /api/admin/pois tạo điểm rồi ghi nội dung, ghi nhật ký; lỗi của service (400) trả nguyên lý do', async () => {
  const res = await send('POST', '/pois', { lat: 10.8, lng: 106.8, radius: 40, content: { vi: { title: 'Cổng', text: 'Chào mừng.' } } });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).id, 'poi-2');
  assert.ok(contents.some((c) => c.poiId === 'poi-2' && c.lang === 'vi' && c.title === 'Cổng'));
  await until(() => changes.length === 1);
  assert.deepEqual(changes[0], { action: 'Thêm điểm', target: 'poi-2', detail: 'Cổng · bán kính 40 m' });
  const bad = await send('POST', '/pois', { lat: 10.8, lng: 106.8, radius: -5 });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Bán kính/);
});

test('PUT /api/admin/pois/:id ẩn điểm ghi nhật ký "Ẩn điểm"; DELETE xóa ở cả 2 service', async () => {
  assert.equal((await (await send('PUT', '/pois/poi-1', { hidden: true })).json()).hidden, true);
  await until(() => changes.length === 1);
  assert.equal(changes[0].action, 'Ẩn điểm');
  assert.equal((await send('DELETE', '/pois/poi-1')).status, 204);
  assert.equal(pois.length, 0);
  assert.equal(contents.length, 0);
  // chờ dòng nhật ký gửi sau, để không rơi sang test kế tiếp
  await until(() => changes.length === 2);
  assert.equal(changes[1].action, 'Xóa điểm');
});

test('nội dung, ngôn ngữ, dời điểm, thống kê, nhật ký chuyển tiếp đúng', async () => {
  assert.equal((await (await send('PUT', '/pois/poi-1/content/en', { title: 'Gate', text: 'Hi.' })).json()).title, 'Gate');
  assert.equal((await send('POST', '/languages', { code: 'zh', name: '中文' })).status, 201);
  assert.equal((await send('POST', '/languages', { code: 'zh', name: '中文' })).status, 409);
  assert.equal((await send('GET', '/languages')).status, 200);
  assert.equal((await send('POST', '/pois/shift', { lat: 21, lng: 105 })).status, 200);
  assert.deepEqual(await (await send('GET', '/stats?range=7d')).json(), { online: 2, range: '7d' });
  await until(() => changes.length === 3);
  assert.deepEqual(changes.map((c) => c.action).sort(), ['Dời cả bộ điểm', 'Sửa nội dung', 'Thêm ngôn ngữ']);
  assert.equal((await (await send('GET', '/changes')).json()).length, 3);
});

test('GET /api/admin/status: service sống ghi ok kèm DB, service chết ghi down', async () => {
  const live = await (await send('GET', '/status')).json();
  assert.deepEqual(live.map((s) => [s.name, s.state]), [['gateway', 'ok'], ['poi-service', 'ok'], ['content-service', 'ok'], ['analytics-service', 'ok']]);
  assert.equal(live[1].db, 'ok');
  const app = listen(createApp({ poiServiceUrl: deadUrl, contentServiceUrl: deadUrl, analyticsServiceUrl: deadUrl, adminPassword: PASSWORD }));
  const dead = await (await fetch(`${app}/api/admin/status`, { headers: { 'X-Admin-Password': PASSWORD } })).json();
  assert.deepEqual(dead.slice(1).map((s) => s.state), ['down', 'down', 'down']);
});

test('POST /api/events trả 202 ngay', async () => {
  const res = await fetch(`${base}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 202);
});
