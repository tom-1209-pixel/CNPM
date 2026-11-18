import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

// Store giả trong bộ nhớ: test API không cần DB (DB có test riêng ở db.test.js).
const PASSWORD = 'quanly';
let content;
let languages;
const fakeStore = {
  listLanguages: async () => languages.filter((l) => !l.hidden).map(({ code, name }) => ({ code, name })),
  listAllLanguages: async () => languages.map((l) => ({ ...l })),
  addLanguage: async (code, name) => {
    if (languages.some((l) => l.code === code)) return null;
    languages.push({ code, name, hidden: false });
    return { code, name, hidden: false };
  },
  updateLanguage: async (code, l) => Object.assign(languages.find((x) => x.code === code), l),
  listContent: async (lang) => content.filter((item) => item.lang === lang),
  listAllContent: async () => content,
  saveContent: async (poiId, lang, title, text) => {
    content = content.filter((c) => !(c.poiId === poiId && c.lang === lang));
    content.push({ poiId, lang, title, text });
    return { poiId, lang, title, text };
  },
  removeContent: async (poiId, lang) => {
    const before = content.length;
    content = content.filter((c) => !(c.poiId === poiId && (!lang || c.lang === lang)));
    return before - content.length;
  },
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
  content = [
    { poiId: 'poi-1', lang: 'vi', title: 'Điểm 1', text: 'Nội dung.' },
    { poiId: 'poi-1', lang: 'en', title: 'Stop 1', text: 'Content.' },
    { poiId: 'poi-2', lang: 'vi', title: 'Điểm 2', text: 'Nội dung.' },
  ];
  languages = [
    { code: 'vi', name: 'Tiếng Việt', hidden: false },
    { code: 'en', name: 'English', hidden: false },
  ];
});
after(() => servers.forEach((s) => s.close()));

test('GET /health trả status ok; ?db=1 cho biết DB đọc được không', async () => {
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
  assert.deepEqual(await (await fetch(`${base}/health?db=1`)).json(), { status: 'ok', db: 'ok' });
});

test('GET /languages trả ngôn ngữ không ẩn; ?all=1 cần mật khẩu, trả cả ngôn ngữ ẩn', async () => {
  languages[1].hidden = true;
  assert.deepEqual(await (await fetch(`${base}/languages`)).json(), [{ code: 'vi', name: 'Tiếng Việt' }]);
  assert.equal((await fetch(`${base}/languages?all=1`)).status, 401);
  assert.equal((await (await send(base, 'GET', '/languages?all=1')).json()).length, 2);
});

test('GET /content?lang=vi chỉ trả nội dung tiếng Việt', async () => {
  const body = await (await fetch(`${base}/content?lang=vi`)).json();
  assert.equal(body.length, 2);
  assert.ok(body.every((item) => item.lang === 'vi'));
});

test('lang không có dữ liệu hoặc thiếu lang thì trả []', async () => {
  for (const q of ['?lang=xx', '']) {
    const res = await fetch(`${base}/content${q}`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  }
});

test('đường sửa dữ liệu: thiếu hoặc sai mật khẩu thì 401, service chưa đặt mật khẩu thì 503', async () => {
  assert.equal((await send(base, 'POST', '/languages', { code: 'zh', name: '中文' }, '')).status, 401);
  assert.equal((await send(base, 'GET', '/content/all', null, 'sai')).status, 401);
  assert.equal((await send(listen(fakeStore), 'PUT', '/content/poi-1/vi', { title: 'x', text: 'y' })).status, 503);
});

test('POST /languages thêm ngôn ngữ; mã sai thì 400; trùng thì 409', async () => {
  const res = await send(base, 'POST', '/languages', { code: 'zh', name: '中文' });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { code: 'zh', name: '中文', hidden: false });
  assert.equal((await send(base, 'POST', '/languages', { code: 'Trung Quốc', name: 'x' })).status, 400);
  assert.equal((await send(base, 'POST', '/languages', { code: 'en', name: 'English' })).status, 409);
});

test('PUT /languages/:code đổi tên, ẩn; không ẩn được Tiếng Việt; không có thì 404', async () => {
  const res = await send(base, 'PUT', '/languages/en', { name: 'Tiếng Anh', hidden: true });
  assert.deepEqual(await res.json(), { code: 'en', name: 'Tiếng Anh', hidden: true });
  assert.equal((await send(base, 'PUT', '/languages/vi', { hidden: true })).status, 400);
  assert.equal((await send(base, 'PUT', '/languages/ko', { name: 'x' })).status, 404);
});

test('PUT /content/:poiId/:lang ghi đè hoặc thêm nội dung; thiếu tên hay ngôn ngữ chưa có thì 400', async () => {
  const res = await send(base, 'PUT', '/content/poi-2/en', { title: 'Stop 2', text: 'Content 2.' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { poiId: 'poi-2', lang: 'en', title: 'Stop 2', text: 'Content 2.' });
  assert.equal(content.length, 4);
  assert.equal((await send(base, 'PUT', '/content/poi-2/en', { title: '', text: 'x' })).status, 400);
  assert.equal((await send(base, 'PUT', '/content/poi-2/ko', { title: 'x', text: 'y' })).status, 400);
});

test('DELETE nội dung: một ngôn ngữ (không xóa riêng bản vi) hoặc cả điểm', async () => {
  assert.equal((await send(base, 'DELETE', '/content/poi-1/en')).status, 204);
  assert.equal((await send(base, 'DELETE', '/content/poi-1/vi')).status, 400);
  assert.equal((await send(base, 'DELETE', '/content/poi-1')).status, 204);
  assert.deepEqual(content.map((c) => c.poiId), ['poi-2']);
});

test('GET /content/all trả nội dung mọi điểm, mọi ngôn ngữ', async () => {
  assert.equal((await (await send(base, 'GET', '/content/all')).json()).length, 3);
});

test('DB lỗi thì /languages và /content trả 500, /health vẫn ok', async () => {
  const fail = async () => {
    throw new Error('DB không kết nối được');
  };
  const broken = listen({ listLanguages: fail, listContent: fail });
  for (const path of ['/languages', '/content?lang=vi']) {
    const res = await fetch(`${broken}${path}`);
    assert.equal(res.status, 500);
    assert.equal(typeof (await res.json()).error, 'string');
  }
  assert.equal((await fetch(`${broken}/health`)).status, 200);
});
