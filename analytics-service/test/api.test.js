import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

// Store giả trong bộ nhớ: test API không cần DB (DB có test riêng ở db.test.js).
const ID = '0b6f2c3e-8d7a-4f1e-9c2b-5a4d3e2f1a0b';
const visits = new Map();
const events = [];
const changes = [];
const PASSWORD = 'bi-mat';
const withPassword = { headers: { 'X-Admin-Password': PASSWORD } };
const fakeStore = {
  recordVisit: async (id, lang) => {
    if (!visits.has(id)) visits.set(id, { lang, pings: 0 });
  },
  ping: async (id, lang) => {
    const v = visits.get(id);
    if (!v) return false;
    v.pings++;
    if (lang) v.lang = lang;
    return true;
  },
  leave: async (id) => {
    const v = visits.get(id);
    if (!v) return false;
    v.left = true;
    return true;
  },
  stats: async (range) => ({ online: visits.size, today: visits.size, range }),
  recordEvent: async (visitId, poiId, kind) => events.push({ visitId, poiId, kind }),
  recordChange: async (action, target, detail) => {
    const change = { id: changes.length + 1, action, target, detail };
    changes.unshift(change);
    return change;
  },
  listChanges: async () => changes,
  checkDb: async () => {},
};

const servers = [];
const listen = (store, options) => {
  const server = createApp(store, options).listen(0);
  servers.push(server);
  return `http://localhost:${server.address().port}`;
};
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let base;
before(() => {
  base = listen(fakeStore, { adminPassword: PASSWORD });
});
after(() => servers.forEach((s) => s.close()));

test('GET /health trả status ok', async () => {
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
});

test('POST /visits ghi một lượt, gửi lại cùng id không tạo lượt mới', async () => {
  assert.equal((await post(base, '/visits', { id: ID, lang: 'vi' })).status, 201);
  assert.equal((await post(base, '/visits', { id: ID, lang: 'vi' })).status, 201);
  assert.equal(visits.size, 1);
});

test('POST /visits từ chối id không phải UUID hoặc thiếu lang', async () => {
  for (const body of [{ id: 'abc', lang: 'vi' }, { id: ID }, { id: ID, lang: 'tiếng việt' }, {}]) {
    assert.equal((await post(base, '/visits', body)).status, 400, JSON.stringify(body));
  }
});

test('POST /visits/:id/ping cập nhật lượt có thật, đổi được ngôn ngữ; lượt không có thì 404', async () => {
  assert.equal((await post(base, `/visits/${ID}/ping`, {})).status, 204);
  assert.equal((await post(base, `/visits/${ID}/ping`, { lang: 'en' })).status, 204);
  assert.equal(visits.get(ID).lang, 'en');
  assert.equal((await post(base, '/visits/1f2e3d4c-5b6a-4978-8a7b-6c5d4e3f2a1b/ping', {})).status, 404);
  assert.equal((await post(base, '/visits/abc/ping', {})).status, 400);
});

test('GET /stats trả số liệu từ store, mặc định khoảng hôm nay; range sai thì 400', async () => {
  assert.deepEqual(await (await fetch(`${base}/stats`, withPassword)).json(), { online: 1, today: 1, range: 'today' });
  assert.equal((await (await fetch(`${base}/stats?range=7d`, withPassword)).json()).range, '7d');
  assert.equal((await fetch(`${base}/stats?range=abc`, withPassword)).status, 400);
});

test('POST /visits/:id/leave đánh dấu lượt đã rời; lượt không có thì 404', async () => {
  assert.equal((await post(base, `/visits/${ID}/leave`, {})).status, 204);
  assert.equal(visits.get(ID).left, true);
  assert.equal((await post(base, '/visits/1f2e3d4c-5b6a-4978-8a7b-6c5d4e3f2a1b/leave', {})).status, 404);
  assert.equal((await post(base, '/visits/abc/leave', {})).status, 400);
});

test('DB lỗi thì trả 500, /health vẫn ok', async () => {
  const fail = async () => {
    throw new Error('DB không kết nối được');
  };
  const broken = listen({ recordVisit: fail, ping: fail, leave: fail, stats: fail }, { adminPassword: PASSWORD });
  assert.equal((await post(broken, '/visits', { id: ID, lang: 'vi' })).status, 500);
  assert.equal((await post(broken, `/visits/${ID}/ping`, {})).status, 500);
  assert.equal((await fetch(`${broken}/stats`, withPassword)).status, 500);
  assert.equal((await fetch(`${broken}/health`)).status, 200);
});

test('GET /stats và nhật ký cần mật khẩu (nhận cả header X-Stats-Password cũ); chưa đặt mật khẩu thì 503', async () => {
  assert.equal((await fetch(`${base}/stats`)).status, 401);
  assert.equal((await fetch(`${base}/stats`, { headers: { 'X-Admin-Password': 'sai' } })).status, 401);
  assert.equal((await fetch(`${base}/stats`, { headers: { 'X-Stats-Password': PASSWORD } })).status, 200);
  assert.equal((await fetch(`${base}/changes`)).status, 401);
  assert.equal((await fetch(`${listen(fakeStore)}/stats`, withPassword)).status, 503);
});

test('POST /events ghi lượt mở/nghe một điểm; dữ liệu sai thì 400', async () => {
  assert.equal((await post(base, '/events', { visitId: ID, poiId: 'poi-1', kind: 'play' })).status, 201);
  assert.deepEqual(events.at(-1), { visitId: ID, poiId: 'poi-1', kind: 'play' });
  for (const body of [{ visitId: 'abc', poiId: 'poi-1', kind: 'open' }, { visitId: ID, poiId: 'poi 1', kind: 'open' }, { visitId: ID, poiId: 'poi-1', kind: 'xem' }]) {
    assert.equal((await post(base, '/events', body)).status, 400, JSON.stringify(body));
  }
});

test('POST /changes ghi nhật ký (cần mật khẩu), GET /changes trả mới nhất trước', async () => {
  const add = (body) => fetch(`${base}/changes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Password': PASSWORD }, body: JSON.stringify(body) });
  assert.equal((await add({ action: 'Thêm điểm', target: 'poi-7', detail: 'bán kính 40 m' })).status, 201);
  assert.equal((await add({ action: 'Xóa điểm', target: 'poi-7' })).status, 201);
  assert.equal((await add({ action: '', target: 'x' })).status, 400);
  const list = await (await fetch(`${base}/changes`, withPassword)).json();
  assert.deepEqual(list.map((c) => c.action), ['Xóa điểm', 'Thêm điểm']);
});

test('GET /health?db=1 cho biết DB đọc được không', async () => {
  assert.deepEqual(await (await fetch(`${base}/health?db=1`)).json(), { status: 'ok', db: 'ok' });
});
