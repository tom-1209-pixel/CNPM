import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { distanceMeters } from '../src/geo.js';

// Store giả trong bộ nhớ: test API không cần DB (DB có test riêng ở db.test.js).
const PASSWORD = 'quanly';
let pois;
const fakeStore = {
  listPois: async () => pois.filter((p) => !p.hidden).map(({ hidden, ...p }) => p),
  listAll: async () => pois.map((p) => ({ ...p })),
  create: async (p) => {
    const poi = { ...p, id: `poi-${pois.length + 1}`, hidden: false };
    pois.push(poi);
    return poi;
  },
  update: async (id, p) => Object.assign(pois.find((x) => x.id === id), p),
  remove: async (id) => pois.length !== (pois = pois.filter((p) => p.id !== id)).length,
  moveAll: async (points) => points.map((m) => Object.assign(pois.find((p) => p.id === m.id), m)),
  checkDb: async () => {},
};

const servers = [];
const listen = (store, options) => {
  const server = createApp(store, options).listen(0);
  servers.push(server);
  return `http://localhost:${server.address().port}`;
};
const send = (base, method, path, body, password = PASSWORD) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(password && { 'X-Admin-Password': password }) },
    body: body && JSON.stringify(body),
  });

let base;
before(() => {
  base = listen(fakeStore, { adminPassword: PASSWORD });
});
beforeEach(() => {
  pois = [
    { id: 'poi-1', lat: 10.7769, lng: 106.7009, radius: 30, hidden: false },
    { id: 'poi-2', lat: 10.7775, lng: 106.702, radius: 30, hidden: false },
  ];
});
after(() => servers.forEach((s) => s.close()));

test('GET /health trả status ok; ?db=1 cho biết DB đọc được không', async () => {
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
  assert.deepEqual(await (await fetch(`${base}/health?db=1`)).json(), { status: 'ok', db: 'ok' });
  const broken = listen({ ...fakeStore, checkDb: async () => { throw new Error('mất DB'); } });
  assert.equal((await (await fetch(`${broken}/health?db=1`)).json()).db, 'error');
});

test('GET /pois trả điểm không ẩn, không có cột hidden', async () => {
  pois[1].hidden = true;
  assert.deepEqual(await (await fetch(`${base}/pois`)).json(), [{ id: 'poi-1', lat: 10.7769, lng: 106.7009, radius: 30 }]);
});

test('GET /pois?all=1 cần mật khẩu, trả cả điểm ẩn', async () => {
  pois[1].hidden = true;
  assert.equal((await fetch(`${base}/pois?all=1`)).status, 401);
  const res = await send(base, 'GET', '/pois?all=1');
  assert.equal((await res.json()).length, 2);
});

test('đường sửa dữ liệu: thiếu hoặc sai mật khẩu thì 401, service chưa đặt mật khẩu thì 503', async () => {
  assert.equal((await send(base, 'POST', '/pois', { lat: 10.8, lng: 106.8, radius: 30 }, '')).status, 401);
  assert.equal((await send(base, 'DELETE', '/pois/poi-1', null, 'sai')).status, 401);
  const open = listen(fakeStore);
  assert.equal((await send(open, 'DELETE', '/pois/poi-1')).status, 503);
  assert.equal(pois.length, 2);
});

test('POST /pois thêm điểm; bán kính âm hoặc không nguyên thì 400; chồng bán kính thì 409', async () => {
  const res = await send(base, 'POST', '/pois', { lat: 10.78, lng: 106.705, radius: 40 });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).id, 'poi-3');
  assert.equal((await send(base, 'POST', '/pois', { lat: 10.79, lng: 106.71, radius: -1 })).status, 400);
  assert.equal((await send(base, 'POST', '/pois', { lat: 10.79, lng: 106.71, radius: 2.5 })).status, 400);
  assert.equal((await send(base, 'POST', '/pois', { lat: 10.79, lng: 106.71, radius: 0 })).status, 201);
  const overlap = await send(base, 'POST', '/pois', { lat: 10.7770, lng: 106.7010, radius: 30 });
  assert.equal(overlap.status, 409);
  assert.match((await overlap.json()).error, /poi-1/);
});

test('PUT /pois/:id sửa vị trí, bán kính, ẩn; dời vào chồng điểm khác thì 409; không có điểm thì 404', async () => {
  const res = await send(base, 'PUT', '/pois/poi-1', { radius: 35, hidden: true });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: 'poi-1', lat: 10.7769, lng: 106.7009, radius: 35, hidden: true });
  assert.equal((await send(base, 'PUT', '/pois/poi-1', { lat: 10.7775, lng: 106.7020 })).status, 409);
  assert.equal((await send(base, 'PUT', '/pois/poi-9', { radius: 30 })).status, 404);
});

test('DELETE /pois/:id xóa điểm; không có thì 404', async () => {
  assert.equal((await send(base, 'DELETE', '/pois/poi-2')).status, 204);
  assert.deepEqual(pois.map((p) => p.id), ['poi-1']);
  assert.equal((await send(base, 'DELETE', '/pois/poi-2')).status, 404);
});

test('POST /pois/shift dời tâm cả bộ điểm về vị trí mới, giữ khoảng cách giữa các điểm', async () => {
  const before = distanceMeters(pois[0], pois[1]);
  const res = await send(base, 'POST', '/pois/shift', { lat: 21.0285, lng: 105.8542 });
  assert.equal(res.status, 200);
  const moved = await res.json();
  const center = (key) => moved.reduce((s, p) => s + p[key], 0) / moved.length;
  assert.ok(Math.abs(center('lat') - 21.0285) < 1e-6 && Math.abs(center('lng') - 105.8542) < 1e-6);
  assert.ok(Math.abs(distanceMeters(moved[0], moved[1]) - before) < 1);
  assert.equal((await send(base, 'POST', '/pois/shift', { lat: 'abc', lng: 1 })).status, 400);
});

test('DB lỗi thì GET /pois trả 500, /health vẫn ok', async () => {
  const broken = listen({ listPois: async () => { throw new Error('DB không kết nối được'); } });
  const res = await fetch(`${broken}/pois`);
  assert.equal(res.status, 500);
  assert.equal(typeof (await res.json()).error, 'string');
  assert.equal((await fetch(`${broken}/health`)).status, 200);
});
