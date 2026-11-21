// Tab Thống kê của trang quản lý: theo dõi trực tiếp GET /api/admin/stats.
// Hỏi máy chủ mỗi 5 giây ở phía sau và gộp vào danh sách đang hiện (không làm mất chỗ cuộn, ô tìm).
const $ = (id) => document.getElementById(id);
const POLL_MS = 5000;
const TZ = 'Asia/Ho_Chi_Minh';

const timeOf = (date) => date.toLocaleTimeString('vi-VN', { timeZone: TZ, hour12: false });
const dayOf = (date) => date.toLocaleDateString('vi-VN', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
const shortTime = (date) => date.toLocaleTimeString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút ${s % 60} giây`;
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}

// api(path): gọi /api/admin/<path> kèm mật khẩu. names(): { languages: {code: name}, pois: {id: tên} }.
export function initStats(api, names) {
  let visits = []; // lượt trong khoảng đang chọn, mới nhất trước
  let seen = new Set(); // mã lượt đã hiện, để tô sáng lượt mới
  let pollTimer = null;
  let tickTimer = null;

  // Lượt đang online thì "ở lại" tính tới bây giờ (tự tăng mỗi giây); đã rời thì tính tới lần báo cuối.
  const stayOf = (v) => duration((v.online ? Date.now() : v.lastSeenAt) - v.startedAt);
  const langName = (code) => names().languages[code] ?? code;

  function matches(v, query) {
    if (!query) return true;
    return langName(v.lang).toLowerCase().includes(query) || v.lang.includes(query) || v.code.includes(query);
  }

  function row(v, isNew) {
    const el = document.createElement('div');
    el.className = isNew ? 'log-row new' : 'log-row';
    const cell = (cls, text) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      el.append(span);
      return span;
    };
    cell('log-time', timeOf(v.startedAt));
    cell('log-code', `[${v.code}]`);
    cell('log-lang', langName(v.lang));
    cell('log-stay', `ở lại ${stayOf(v)}`).dataset.code = v.code;
    cell(v.online ? 'log-state on' : 'log-state', v.online ? '● đang online' : `đã rời lúc ${shortTime(v.lastSeenAt)}`);
    return el;
  }

  function renderList() {
    const list = $('log-list');
    const scrollTop = list.scrollTop;
    const query = $('search').value.trim().toLowerCase();
    const shown = visits.filter((v) => matches(v, query));
    $('count').textContent = `${shown.length} lượt`;
    if (shown.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'log-empty';
      empty.textContent = query ? 'Không có lượt nào khớp.' : 'Chưa có lượt truy cập nào trong khoảng này.';
      list.replaceChildren(empty);
      return;
    }
    const nodes = [];
    let day = '';
    for (const v of shown) {
      const d = dayOf(v.startedAt);
      if (d !== day) {
        day = d;
        const header = document.createElement('div');
        header.className = 'log-day';
        header.textContent = d.charAt(0).toUpperCase() + d.slice(1);
        nodes.push(header);
      }
      nodes.push(row(v, seen.size > 0 && !seen.has(v.code)));
    }
    list.replaceChildren(...nodes);
    list.scrollTop = scrollTop;
    for (const v of visits) seen.add(v.code);
  }

  // Theo điểm: số lần mở thẻ, số lần nghe trong khoảng đang chọn, nhiều nhất trước.
  function renderByPoi(byPoi) {
    const body = $('by-poi');
    if (byPoi.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.className = 'muted';
      td.textContent = 'Chưa có lượt mở hay nghe điểm nào trong khoảng này.';
      tr.append(td);
      body.replaceChildren(tr);
      return;
    }
    body.replaceChildren(
      ...byPoi.map((p) => {
        const tr = document.createElement('tr');
        for (const text of [names().pois[p.poiId] ? `${names().pois[p.poiId]} (${p.poiId})` : p.poiId, p.opens, p.plays]) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.append(td);
        }
        return tr;
      }),
    );
  }

  function render(stats) {
    $('t-online').textContent = stats.online;
    $('t-today').textContent = stats.today;
    $('t-30').textContent = stats.last30Days;
    $('t-avg').textContent = stats.avgMinutes.toLocaleString('vi-VN');
    visits = stats.visits.map((v) => ({ ...v, startedAt: new Date(v.startedAt), lastSeenAt: new Date(v.lastSeenAt) }));
    renderList();
    renderByPoi(stats.byPoi ?? []);
  }

  function setLive(ok, message) {
    $('live').className = ok ? 'live' : 'live off';
    $('live').textContent = ok ? '● Trực tiếp' : '● Mất kết nối, đang thử lại';
    $('updated').textContent = message;
  }

  async function poll() {
    try {
      render(await api(`/stats?range=${$('range').value}`));
      setLive(true, `Cập nhật lúc ${timeOf(new Date())}`);
    } catch (err) {
      setLive(false, err.message);
    }
  }

  // "ở lại" của lượt đang online tăng từng giây mà không cần hỏi máy chủ.
  function tick() {
    for (const el of document.querySelectorAll('.log-stay')) {
      const v = visits.find((x) => x.code === el.dataset.code);
      if (v?.online) el.textContent = `ở lại ${stayOf(v)}`;
    }
  }

  // Đổi khoảng thời gian: tải lại ngay, không tô sáng cả danh sách như lượt mới.
  $('range').onchange = () => {
    seen = new Set();
    $('log-list').scrollTop = 0;
    poll();
  };
  $('search').oninput = renderList;

  return {
    // Bắt đầu theo dõi khi mở tab Thống kê, dừng khi sang tab khác (đỡ gọi máy chủ không cần thiết).
    start() {
      if (pollTimer) return;
      poll();
      pollTimer = setInterval(poll, POLL_MS);
      tickTimer = setInterval(tick, 1000);
    },
    stop() {
      clearInterval(pollTimer);
      clearInterval(tickTimer);
      pollTimer = null;
    },
  };
}
