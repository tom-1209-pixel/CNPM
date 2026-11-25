// Trang quản lý: đăng nhập một lần (mật khẩu chỉ giữ trong bộ nhớ trang), rồi các tab
// Điểm tham quan, Ngôn ngữ, Thống kê, Hệ thống, Nhật ký. Mọi yêu cầu đi qua /api/admin/* của gateway.
import { initPois, initLanguages } from './admin-pois.js';
import { initStats } from './stats.js';
import { wakeServices } from './wake.js';

const $ = (id) => document.getElementById(id);
const TZ = 'Asia/Ho_Chi_Minh';
const TABS = ['diem', 'ngon-ngu', 'thong-ke', 'he-thong', 'nhat-ky'];

let password = '';
let names = { pois: {}, languages: {} };
let modules = null;
let systemTimer = null;
let toastTimer = null;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Password': password },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `Lỗi ${res.status}`), { status: res.status });
  return data;
}

function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  // Không dùng class "error": style.css đã có .error (khung lỗi cố định ở đầu trang du khách).
  el.className = isError ? 'toast toast-error' : 'toast';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 6000 : 2500);
}

const timeOf = (value) => new Date(value).toLocaleString('vi-VN', { timeZone: TZ, hour12: false });

function cells(tr, values) {
  for (const value of values) {
    const td = document.createElement('td');
    if (value instanceof Node) td.append(value);
    else td.textContent = value;
    tr.append(td);
  }
  return tr;
}

// ---------- Hệ thống ----------

const STATE_TEXT = { ok: 'Đang chạy', down: 'Không phản hồi', error: 'Lỗi' };
const DB_TEXT = { ok: 'Đọc được', error: 'Lỗi' };
const SERVICE_NOTE = {
  gateway: 'Cửa vào, web tĩnh, ghép dữ liệu',
  'poi-service': 'Vị trí và bán kính các điểm',
  'content-service': 'Nội dung, ngôn ngữ, âm thanh',
  'analytics-service': 'Lượt truy cập, nhật ký',
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const icon = (name) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
};

// Mỗi service một thẻ: tên, trạng thái, thời gian phản hồi, DB.
function serviceCard(s) {
  const card = el('article', 'service');
  const top = el('div', 'service-top');
  const name = el('div', 'service-name');
  name.append(icon('server'), s.name);
  top.append(name, el('span', `state ${s.state}`, STATE_TEXT[s.state]));
  const facts = el('div', 'service-facts');
  for (const [label, value] of [
    ['Phản hồi', s.state === 'ok' ? `${s.ms} ms` : '–'],
    ['Database', s.name === 'gateway' ? 'Không dùng' : DB_TEXT[s.db] ?? '–'],
  ]) {
    const fact = el('div');
    fact.append(el('span', '', label), el('strong', '', value));
    facts.append(fact);
  }
  card.append(top, el('p', 'note', s.state === 'down' ? 'Có thể đang ngủ: bấm "Đánh thức tất cả".' : SERVICE_NOTE[s.name] ?? ''), facts);
  return card;
}

async function refreshStatus() {
  try {
    const rows = await api('/status');
    $('system-rows').replaceChildren(...rows.map(serviceCard));
    $('system-updated').textContent = `Cập nhật lúc ${timeOf(Date.now())} · tự cập nhật mỗi 10 giây`;
  } catch (err) {
    $('system-updated').textContent = err.message;
  }
}

$('btn-wake').onclick = async () => {
  toast('Đang đánh thức, chờ khoảng 15 giây…');
  wakeServices();
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    await refreshStatus();
  }
};

// ---------- Nhật ký ----------

// Màu chip theo loại hành động: thêm (xanh lá), xóa (đỏ), âm thanh (tím), còn lại (xanh dương).
const actionClass = (action) =>
  /^Thêm/.test(action) ? 'action-chip add' : /^Xóa/.test(action) ? 'action-chip remove' : /âm thanh/i.test(action) ? 'action-chip audio' : 'action-chip';

async function loadChanges() {
  try {
    const rows = await api('/changes');
    if (rows.length === 0) {
      const tr = document.createElement('tr');
      cells(tr, ['Chưa có thay đổi nào.', '', '', '']);
      $('change-rows').replaceChildren(tr);
      return;
    }
    $('change-rows').replaceChildren(...rows.map((c) => cells(document.createElement('tr'), [timeOf(c.at), el('span', actionClass(c.action), c.action), c.target, c.detail])));
  } catch (err) {
    toast(err.message, true);
  }
}
$('btn-log-refresh').onclick = loadChanges;

// ---------- Tab ----------

function showTab(tab) {
  if (!TABS.includes(tab)) tab = 'diem';
  for (const t of TABS) {
    $(`tab-${t}`).hidden = t !== tab;
    document.querySelector(`[data-tab="${t}"]`).setAttribute('aria-selected', String(t === tab));
  }
  history.replaceState(null, '', `#${tab}`);
  // Chỉ chạy việc định kỳ của tab đang mở.
  if (tab === 'thong-ke') modules.stats.start();
  else modules.stats.stop();
  clearInterval(systemTimer);
  if (tab === 'he-thong') {
    refreshStatus();
    systemTimer = setInterval(refreshStatus, 10000);
  }
  if (tab === 'nhat-ky') loadChanges();
  if (tab === 'diem') modules.pois.resize();
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => showTab(button.dataset.tab);
// Liên kết "mục Ngôn ngữ" trong form điểm.
$('f-goto-lang').onclick = (event) => {
  event.preventDefault();
  showTab('ngon-ngu');
};

// ---------- Đăng nhập ----------

wakeServices();

// Mật khẩu chỉ nằm trong bộ nhớ trang: tải lại trang là quên mật khẩu, về màn đăng nhập (giữ mục đang mở trên địa chỉ).
$('btn-logout').onclick = () => location.reload();

$('login').onsubmit = async (event) => {
  event.preventDefault();
  password = $('password').value;
  const submit = $('login').querySelector('button');
  submit.disabled = true;
  submit.textContent = 'Đang tải, có thể mất tới 1 phút…';
  try {
    await api('/languages'); // kiểm tra mật khẩu
    $('login-screen').hidden = true;
    $('app').hidden = false;
    // Hai tab dùng chung dữ liệu điểm: sửa ở tab này thì tab kia tải lại.
    const pois = initPois({ api, toast, onNames: (n) => (names = n), onChange: () => modules.languages.reload().catch(() => {}) });
    modules = {
      pois,
      languages: initLanguages({ api, toast, onChange: () => pois.reload() }),
      stats: initStats((path) => api(path), () => names),
    };
    showTab(location.hash.slice(1));
    await Promise.all([pois.reload(), modules.languages.reload()]);
  } catch (err) {
    password = '';
    $('login-error').textContent = err.message;
    $('login-error').hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Vào trang quản lý';
  }
};
