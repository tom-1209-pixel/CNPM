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

const STATE_TEXT = { ok: '● Đang chạy', down: '● Không phản hồi (có thể đang ngủ)', error: '● Lỗi' };
const DB_TEXT = { ok: 'Đọc được', error: 'Lỗi' };

async function refreshStatus() {
  try {
    const rows = await api('/status');
    $('system-rows').replaceChildren(
      ...rows.map((s) => {
        const state = document.createElement('span');
        state.className = `state ${s.state}`;
        state.textContent = STATE_TEXT[s.state];
        return cells(document.createElement('tr'), [s.name, state, s.state === 'ok' ? `${s.ms} ms` : '–', s.name === 'gateway' ? 'không dùng DB' : DB_TEXT[s.db] ?? '–']);
      }),
    );
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

async function loadChanges() {
  try {
    const rows = await api('/changes');
    if (rows.length === 0) {
      const tr = document.createElement('tr');
      cells(tr, ['Chưa có thay đổi nào.', '', '', '']);
      $('change-rows').replaceChildren(tr);
      return;
    }
    $('change-rows').replaceChildren(...rows.map((c) => cells(document.createElement('tr'), [timeOf(c.at), c.action, c.target, c.detail])));
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

// ---------- Đăng nhập ----------

wakeServices();

$('login').onsubmit = async (event) => {
  event.preventDefault();
  password = $('password').value;
  const submit = $('login').querySelector('button');
  submit.disabled = true;
  submit.textContent = 'Đang tải, có thể mất tới 1 phút…';
  try {
    await api('/languages'); // kiểm tra mật khẩu
    $('login').hidden = true;
    $('app').hidden = false;
    const pois = initPois({ api, toast, onNames: (n) => (names = n) });
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
