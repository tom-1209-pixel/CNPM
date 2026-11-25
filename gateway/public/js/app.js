import { distanceMeters, bearingDegrees, isInside, isAccurateEnough } from './geo.js';
import { createPlayer, unlockAudio } from './speech.js';
import { addBaseMap } from './basemap.js';
import { wakeServices } from './wake.js';

const $ = (id) => document.getElementById(id);
const SIM = new URLSearchParams(location.search).get('sim') === '1';

// Mọi trạng thái nằm trong đối tượng này và chỉ tồn tại trong bộ nhớ trang:
// tải lại trang là về mặc định (không dùng localStorage, cookie).
const state = {
  lang: 'vi',
  languages: [],
  pois: [],
  mode: 'both', // 'listen' | 'read' | 'both'
  auto: true,
  pos: null, // { lat, lng, accuracy }
  geoDenied: false,
  geoError: '', // lời hướng dẫn khi chưa lấy được vị trí (GPS tắt, quá thời gian)
  panelId: null,
  destId: null,
  arrivedId: null,
  played: new Set(), // POI đã tự phát một lần
  audioBroken: new Set(), // POI có file âm thanh nhưng tải hoặc phát lỗi: chỉ còn hiện chữ
  notice: '',
  tilesFailed: false,
  degraded: null, // service đang hỏng theo gateway (header X-Degraded): 'content-service' | 'poi-service' | null
};

const player = createPlayer(
  () => render(),
  (error, id) => {
    if (error === 'not-allowed') {
      // Một số máy chặn tự phát khi chưa chạm màn hình: chỉ nhắc bấm Phát.
      state.notice = 'Trình duyệt chặn tự phát âm thanh khi chưa chạm màn hình. Bấm "Phát" để nghe.';
    } else {
      // File lỗi hoặc mất mạng: điểm này chỉ còn hiện chữ, các điểm khác vẫn nghe bình thường.
      state.audioBroken.add(id);
      state.notice = `Không phát được âm thanh của điểm này (mã lỗi: ${error}). Bạn vẫn đọc được nội dung.`;
    }
    render();
  },
);
let chosenLang = 'vi';
let map = null;
let poiLayer = null;
let markers = new Map();
let userMarker = null;
let destLine = null;
let wakeLock = null;
let retryFn = null;

const poiById = (id) => state.pois.find((p) => p.id === id);
const locationUsable = () => !!state.pos && isAccurateEnough(state.pos.accuracy);
// Khi một service hỏng, POI có thể thiếu tọa độ (poi-service) hoặc thiếu tên và nội dung (content-service).
const hasCoords = (poi) => typeof poi?.lat === 'number';
const titleOf = (poi) => poi.title ?? `Điểm ${state.pois.indexOf(poi) + 1}`;

// ---------- Mạng và lỗi ----------

async function request(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const api = async (path) => (await request(path)).json();

function showError(message, retry) {
  retryFn = retry;
  $('error-text').textContent = message;
  $('error-retry').hidden = !retry;
  $('error').hidden = false;
}

function clearError() {
  $('error').hidden = true;
  retryFn = null;
}

$('error-retry').onclick = () => {
  wakeServices();
  const fn = retryFn;
  clearError();
  if (fn) fn();
};

// ---------- Thống kê lượt truy cập ----------

// Ẩn danh: mã lượt là số ngẫu nhiên chỉ nằm trong bộ nhớ trang (tải lại trang là lượt mới), không cookie,
// không localStorage, không gửi vị trí. Gửi lỗi thì bỏ qua: thống kê không được ảnh hưởng du khách.
// randomUUID chỉ có từ iOS 15.4: máy cũ hơn tự tạo UUID v4 từ getRandomValues.
function newVisitId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (!c?.getRandomValues) return null;
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const visitId = newVisitId();
let visitStarted = false;

function sendVisit(path, body) {
  if (!visitId) return;
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
}

// Thống kê theo điểm: du khách mở thẻ (open) hoặc nghe (play) một điểm. Chỉ gửi khi đã có lượt truy cập.
function trackEvent(poiId, kind) {
  if (visitStarted) sendVisit('/api/events', { visitId, poiId, kind });
}

// Mở thẻ một điểm (bấm ghim, bấm tên trong danh sách, tự thuyết minh).
function openPanel(id) {
  if (state.panelId !== id) trackEvent(id, 'open');
  state.panelId = id;
}

function startVisit() {
  if (visitStarted) return;
  visitStarted = true;
  sendVisit('/api/visits', { id: visitId, lang: state.lang });
  // Báo "còn mở" mỗi 30 giây, kể cả khi trang ở tab nền (chuyển tab vẫn tính là đang dùng).
  // Trình duyệt dừng hẳn trang (tắt màn hình điện thoại, mất mạng) thì không báo được: sau 2 phút coi là đã rời.
  setInterval(() => sendVisit(`/api/visits/${visitId}/ping`, {}), 30000);
  // Đóng tab hoặc rời trang: báo rời ngay. sendBeacon vẫn gửi được khi trang đang đóng.
  addEventListener('pagehide', () => navigator.sendBeacon?.(`/api/visits/${visitId}/leave`));
  // Quay lại trang từ bộ nhớ đệm của trình duyệt (nút Back): báo "còn mở" để tính online lại.
  addEventListener('pageshow', (event) => {
    if (event.persisted) sendVisit(`/api/visits/${visitId}/ping`, {});
  });
}

// ---------- Chọn ngôn ngữ ----------

function renderChoices(container, selected, onPick) {
  container.replaceChildren();
  for (const lang of state.languages) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.textContent = lang.name;
    button.setAttribute('aria-pressed', String(lang.code === selected));
    button.onclick = () => onPick(lang.code);
    container.append(button);
  }
}

function pickStartLang(code) {
  chosenLang = code;
  renderChoices($('lang-choices'), chosenLang, pickStartLang);
}

// content-service hỏng thì không có danh sách ngôn ngữ: tạm dùng tiếng Việt để du khách vẫn vào được bản đồ.
const FALLBACK_LANGUAGES = [{ code: 'vi', name: 'Tiếng Việt' }];

async function loadLanguages() {
  try {
    state.languages = await api('/api/languages');
    clearError();
  } catch {
    state.languages = FALLBACK_LANGUAGES;
    showError('Chưa tải được danh sách ngôn ngữ nên tạm dùng Tiếng Việt.', loadLanguages);
  }
  if (!state.languages.some((l) => l.code === chosenLang)) chosenLang = state.languages[0]?.code ?? 'vi';
  pickStartLang(chosenLang);
  $('btn-start').disabled = state.languages.length === 0;
}

// Trả { pois, degraded }; null khi không lấy được gì (cả hai service hỏng hoặc mất mạng).
async function fetchPois(lang, retry) {
  try {
    const res = await request(`/api/pois?lang=${encodeURIComponent(lang)}`);
    const pois = await res.json();
    clearError();
    return { pois, degraded: res.headers.get('X-Degraded') };
  } catch {
    showError('Không tải được dữ liệu điểm tham quan. Hãy kiểm tra kết nối mạng rồi thử lại.', retry);
    return null;
  }
}

function setPois({ pois, degraded }) {
  const hadCoords = state.pois.some(hasCoords);
  state.pois = pois;
  state.degraded = degraded;
  if (degraded === 'poi-service') {
    state.destId = null; // không có tọa độ thì không chỉ đường được
  }
  if (map) {
    drawPois();
    if (!hadCoords) fitView();
  }
}

// Nút "Thử lại" khi đang thiếu một service: tải lại, service đã hồi phục thì bản đồ và nội dung hiện đủ.
async function reloadPois() {
  const button = $('degraded-retry');
  button.disabled = true;
  const result = await fetchPois(state.lang, reloadPois);
  button.disabled = false;
  if (!result) return;
  setPois(result);
  if (state.languages === FALLBACK_LANGUAGES && result.degraded !== 'content-service') {
    api('/api/languages')
      .then((languages) => {
        state.languages = languages;
        render();
      })
      .catch(() => {});
  }
  evaluate();
  render();
}
$('degraded-retry').onclick = reloadPois;

$('btn-start').onclick = async () => {
  unlockAudio();
  // Máy chủ gói Free đang "ngủ" có thể cần tới 1 phút để trả lời: báo đang tải thay vì để nút đứng im.
  const startButton = $('btn-start');
  startButton.disabled = true;
  startButton.textContent = 'Đang tải, có thể mất tới 1 phút…';
  const result = await fetchPois(chosenLang, () => startButton.click());
  startButton.disabled = false;
  startButton.textContent = 'Bắt đầu tham quan';
  if (!result) return;
  state.lang = chosenLang;
  setPois(result);
  $('screen-lang').hidden = true;
  $('screen-map').hidden = false;
  initMap();
  startLocation();
  requestWakeLock();
  startVisit();
  render();
};

$('btn-lang').onclick = () => {
  let pending = state.lang;
  const draw = () =>
    renderChoices($('dlg-choices'), pending, (code) => {
      pending = code;
      draw();
    });
  draw();
  $('dlg-ok').onclick = () => {
    $('dlg-lang').close();
    applyLang(pending);
  };
  $('dlg-cancel').onclick = () => $('dlg-lang').close();
  $('dlg-lang').showModal();
};

// Đổi ngôn ngữ: âm thanh dừng và về đầu, "đã tự phát" và điểm đến được giữ nguyên.
async function applyLang(code) {
  if (code === state.lang) return;
  const result = await fetchPois(code, () => applyLang(code));
  if (!result) return;
  player.stop();
  state.lang = code;
  setPois(result);
  if (visitStarted) sendVisit(`/api/visits/${visitId}/ping`, { lang: code });
  state.notice = '';
  render();
}

// ---------- Bản đồ ----------

const createPoiIcon = () =>
  L.divIcon({
    className: 'poi-pin',
    html: '<svg viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37C15 37 2 25 2 14a13 13 0 0 1 26 0c0 11-13 23-13 23z" fill="currentColor" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>',
    iconSize: [30, 38],
    iconAnchor: [15, 37],
  });

// Thanh trên và thẻ điểm nổi lên trên bản đồ: báo chiều cao cho CSS để nút phóng to và dòng ghi nguồn không bị che.
function trackInset(el, cssVar) {
  const update = () => $('map').style.setProperty(cssVar, el.offsetHeight ? `${el.offsetHeight + 16}px` : '0px');
  new ResizeObserver(update).observe(el);
}

// Vẽ lại ghim và vòng bán kính mỗi khi danh sách POI đổi (đổi ngôn ngữ, "Thử lại" sau khi service hồi phục).
function drawPois() {
  poiLayer?.remove();
  poiLayer = L.layerGroup().addTo(map);
  markers = new Map();
  const poiIcon = createPoiIcon();
  for (const poi of state.pois.filter(hasCoords)) {
    L.circle([poi.lat, poi.lng], { radius: poi.radius, color: '#2563eb', weight: 2, fillOpacity: 0.16, interactive: false }).addTo(poiLayer);
    const marker = L.marker([poi.lat, poi.lng], { icon: poiIcon }).addTo(poiLayer);
    marker.bindTooltip(titleOf(poi), { permanent: true, direction: 'top', offset: [0, -34], className: 'poi-label' });
    marker.on('click', () => {
      openPanel(poi.id);
      render();
    });
    markers.set(poi.id, marker);
  }
}

function fitView() {
  const located = state.pois.filter(hasCoords);
  if (located.length > 0) {
    map.fitBounds(L.latLngBounds(located.map((p) => [p.lat, p.lng])).pad(0.5), { maxZoom: 18 });
  } else {
    map.setView([10.7769, 106.7009], 16);
  }
}

function initMap() {
  map = L.map('map');
  addBaseMap(map, (failed) => {
    state.tilesFailed = failed;
    render();
  });
  drawPois();
  fitView();
  $('btn-sim-reset').hidden = !SIM;
  if (SIM) map.on('click', (e) => setPosition({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: 5 }));
  new ResizeObserver(() => map.invalidateSize()).observe($('map'));
  trackInset($('overlay-top'), '--top-h');
  trackInset($('bottom'), '--bottom-h');
}

// ---------- Vị trí ----------

// Trình duyệt nhúng trong ứng dụng (mở link từ Zalo, Facebook, Messenger, Instagram) thường chặn vị trí mà không hỏi.
const IN_APP_BROWSER = /Zalo|FBAN|FBAV|FB_IAB|Instagram|Line\//i.test(navigator.userAgent);
let watchId = null;

// Trình duyệt chỉ hỏi quyền vị trí một lần: đã chặn (hoặc đóng hộp hỏi) thì lần sau báo "từ chối" ngay mà không hỏi lại.
// Trang không ép được trình duyệt hỏi lại, nên báo cách bật lại và có nút "Thử lại định vị" (gọi lại hàm này).
function startLocation() {
  if (SIM) return;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  if (!navigator.geolocation) {
    state.geoDenied = true;
    render();
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (p) => setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        watchId = null;
        state.geoDenied = true;
        state.pos = null;
        state.destId = null;
        state.auto = false;
      } else if (err.code === err.TIMEOUT) {
        state.geoError = 'Chưa lấy được vị trí. Hãy ra chỗ thoáng và bật Định vị (GPS).';
      } else {
        state.geoError = 'Không lấy được vị trí. Hãy bật Định vị (GPS) của điện thoại.';
      }
      render();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
}

// Người dùng bật lại quyền vị trí (trong cài đặt trang) rồi bấm nút này: theo dõi vị trí lại, Tự động về mặc định (bật).
$('geo-retry').onclick = () => {
  state.geoDenied = false;
  state.auto = true;
  state.geoError = '';
  startLocation();
  render();
};
// Quyền vị trí đổi trong lúc đang mở trang (trình duyệt hỗ trợ Permissions API): tự theo dõi lại khi được cho phép.
navigator.permissions?.query({ name: 'geolocation' }).then((permission) => {
  permission.onchange = () => {
    if (permission.state === 'granted' && state.geoDenied && map) $('geo-retry').click();
  };
}).catch(() => {});

function setPosition(pos) {
  state.pos = pos;
  state.geoError = '';
  evaluate();
  render();
}

// Kích hoạt tự thuyết minh và "đã tới nơi" chỉ khi vị trí đủ chính xác.
function evaluate() {
  if (!locationUsable()) return;
  for (const poi of state.pois.filter(hasCoords)) {
    if (isInside(state.pos, poi)) {
      if (state.destId === poi.id) {
        state.arrivedId = poi.id;
        state.destId = null;
      }
      // chưa có nội dung (content-service hỏng) thì chưa tính là đã tự phát: có lại nội dung mà vẫn đứng đây thì phát
      if (state.auto && poi.text && !state.played.has(poi.id)) autoPlay(poi.id);
    }
  }
}

// Vào điểm mới thì luôn chuyển sang điểm đó: đang nghe điểm khác thì dừng điểm cũ (player.play tự dừng) rồi phát điểm mới.
// Muốn nghe lại điểm cũ thì bấm điểm đó trên bản đồ. Điểm chưa có file âm thanh thì chỉ mở thẻ (thẻ hiện chữ), vẫn tính là đã tự phát.
function autoPlay(id) {
  state.played.add(id);
  openPanel(id);
  if (state.mode !== 'read') startPlay(id);
}

// Điểm nghe được khi có file mp3 và lần phát trước không lỗi.
const canListen = (poi) => !!poi?.audioUrl && !state.audioBroken.has(poi.id);

function startPlay(id) {
  const poi = poiById(id);
  if (!canListen(poi)) return;
  openPanel(id);
  trackEvent(id, 'play');
  player.play(id, poi.audioUrl);
}

// ---------- Giữ màn hình sáng ----------

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // không hỗ trợ hoặc bị từ chối: bỏ qua
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && map) requestWakeLock();
});

// ---------- Điều khiển ----------

for (const button of document.querySelectorAll('#seg-mode button')) {
  button.onclick = () => {
    state.mode = button.dataset.mode;
    state.notice = '';
    if (state.mode === 'read') player.stop();
    render();
  };
}

$('btn-auto').onclick = () => {
  if (state.geoDenied || state.degraded === 'poi-service') return;
  state.auto = !state.auto;
  if (state.auto) evaluate(); // bật lại khi đang đứng trong bán kính thì phát ngay
  render();
};

$('btn-play').onclick = () => {
  if (player.state === 'paused' && player.poiId === state.panelId) player.resume();
  else startPlay(state.panelId);
};
$('btn-pause').onclick = () => player.pause();
$('btn-stop').onclick = () => player.stop();
$('btn-replay').onclick = () => startPlay(state.panelId);
$('now-playing-stop').onclick = () => player.stop();

$('btn-dest').onclick = () => {
  if (state.geoDenied || !hasCoords(poiById(state.panelId))) return;
  state.destId = state.panelId;
  evaluate(); // đang đứng trong bán kính thì hiện "Bạn đã tới nơi" ngay
  render();
};
$('nav-cancel').onclick = () => {
  state.destId = null;
  render();
};
$('arrived-ok').onclick = () => {
  state.arrivedId = null;
  render();
};
// Chỉ có ở ?sim=1: xóa trạng thái "đã tự phát" để thử lại trong phòng mà không cần tải lại trang.
$('btn-sim-reset').onclick = () => {
  player.stop();
  state.played.clear();
  state.arrivedId = null;
  state.destId = null;
  state.panelId = null;
  evaluate(); // vẫn đang đứng trong vòng và tự động bật thì phát ngay, như quy tắc "bật lại khi vẫn đứng trong bán kính"
  render();
};
$('btn-close').onclick = () => {
  player.stop();
  state.panelId = null;
  render();
};

// ---------- Hiển thị ----------

const GEO_DENIED_TEXT =
  'Trang chưa được dùng vị trí nên chưa chỉ đường và tự thuyết minh được. Cách bật: bấm biểu tượng bên trái địa chỉ trang → Quyền (Cài đặt trang web) → Vị trí → Cho phép, rồi bấm "Thử lại định vị". Bạn vẫn bấm vào điểm để nghe hoặc đọc.';
const IN_APP_TEXT =
  'Bạn đang mở trang trong ứng dụng (Zalo, Facebook…), ứng dụng này không cho dùng vị trí. Bấm ⋮ hoặc ··· ở góc trên → "Mở bằng trình duyệt" (Chrome, Safari).';
// Sai số từ 1 km trở lên: thường là điện thoại chỉ cho trình duyệt vị trí gần đúng, hoặc GPS đang tắt.
const APPROXIMATE_TEXT = (km) =>
  `Điện thoại đang cho trang vị trí gần đúng (sai số ~${km} km). Bật Định vị (GPS) và cho Chrome dùng vị trí chính xác: Cài đặt → Ứng dụng → Chrome → Quyền → Vị trí → bật "Dùng vị trí chính xác". Ra chỗ thoáng để GPS bắt sóng.`;
const DEGRADED_TEXT = {
  'content-service': 'Tạm thời chưa tải được nội dung thuyết minh. Bản đồ và chỉ đường vẫn dùng được.',
  'poi-service': 'Tạm thời chưa tải được vị trí các điểm nên chưa chỉ đường và tự thuyết minh được. Chọn tên điểm bên dưới để nghe hoặc đọc.',
};
const NO_CONTENT_TEXT = 'Tạm thời chưa có nội dung thuyết minh cho điểm này.';
const NO_AUDIO_TEXT = 'Điểm này chưa có âm thanh, bạn đọc nội dung ở trên.';

function render() {
  if (!map) return;
  const lang = state.languages.find((l) => l.code === state.lang);
  $('btn-lang-label').textContent = lang ? lang.name : state.lang;
  for (const button of document.querySelectorAll('#seg-mode button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  }

  const autoButton = $('btn-auto');
  autoButton.setAttribute('aria-pressed', String(state.auto));
  autoButton.disabled = state.geoDenied || state.degraded === 'poi-service';
  $('degraded').hidden = !state.degraded;
  $('degraded-text').textContent = DEGRADED_TEXT[state.degraded] ?? '';

  let status = '';
  if (state.geoDenied) status = IN_APP_BROWSER ? IN_APP_TEXT : GEO_DENIED_TEXT;
  else if (SIM && !state.pos) status = 'Chế độ giả lập: bấm lên bản đồ để đặt vị trí của bạn.';
  else if (!locationUsable()) {
    if (state.geoError && !state.pos) {
      status = state.geoError;
    } else {
      status = 'Đang xác định vị trí…';
      if (state.pos?.accuracy >= 1000) status = APPROXIMATE_TEXT((state.pos.accuracy / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }));
      else if (state.pos) status += ` (sai số ${Math.round(state.pos.accuracy)} m, cần ≤ 50 m để tự thuyết minh)`;
    }
  }
  $('status').textContent = status;
  $('status').hidden = !status;
  $('geo-retry').hidden = !state.geoDenied || IN_APP_BROWSER || !navigator.geolocation;
  $('notice').textContent = state.notice;
  $('notice').hidden = !state.notice;
  $('sim-audio').hidden = !SIM;
  if (SIM) $('sim-audio').textContent = audioDiagnostic();
  $('tiles-warn').hidden = !state.tilesFailed;

  for (const poi of state.pois) markers.get(poi.id)?.setTooltipContent(titleOf(poi));

  renderMapOverlay();
  renderArrived();
  renderNav();
  renderNowPlaying();
  renderPoiList();
  renderPanel();
  // Thẻ nổi phía dưới chỉ hiện khi có gì để hiện.
  $('bottom').hidden =
    $('nav').hidden && $('now-playing').hidden && $('poi-list').childElementCount === 0 && $('panel').hidden;
}

// Chỉ ở ?sim=1: cho biết có bao nhiêu điểm nghe được (có file mp3), để chẩn đoán khi điện thoại không nghe được.
function audioDiagnostic() {
  const withAudio = state.pois.filter((p) => !!p.audioUrl).length;
  const error = player.lastError ? `; lỗi phát gần nhất: ${player.lastError}` : '';
  return `Âm thanh: ${withAudio}/${state.pois.length} điểm có file mp3 cho "${state.lang}"${error}.`;
}

function renderMapOverlay() {
  if (state.pos) {
    const latlng = [state.pos.lat, state.pos.lng];
    if (userMarker) userMarker.setLatLng(latlng);
    else userMarker = L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map);
  } else if (userMarker) {
    userMarker.remove();
    userMarker = null;
  }
  const dest = state.destId ? poiById(state.destId) : null;
  if (dest && state.pos) {
    const points = [[state.pos.lat, state.pos.lng], [dest.lat, dest.lng]];
    if (destLine) destLine.setLatLngs(points);
    else destLine = L.polyline(points, { color: '#2563eb', weight: 3, dashArray: '6 8' }).addTo(map);
  } else if (destLine) {
    destLine.remove();
    destLine = null;
  }
}

function renderArrived() {
  const poi = state.arrivedId ? poiById(state.arrivedId) : null;
  $('arrived').hidden = !poi;
  if (poi) $('arrived-text').textContent = `Bạn đã tới nơi: ${titleOf(poi)}`;
}

function renderNav() {
  const dest = state.destId ? poiById(state.destId) : null;
  $('nav').hidden = !dest;
  if (!dest) return;
  // Chỉ hướng vẫn hiện khi vị trí kém chính xác (kèm sai số); ngưỡng 50 m chỉ dùng để tự phát và báo "đã tới nơi".
  if (state.pos) {
    const meters = Math.round(distanceMeters(state.pos, dest)).toLocaleString('vi-VN');
    const accuracy = locationUsable() ? '' : ` (sai số ~${Math.round(state.pos.accuracy)} m)`;
    $('nav-arrow').hidden = false;
    $('nav-arrow').style.transform = `rotate(${bearingDegrees(state.pos, dest)}deg)`;
    $('nav-text').textContent = `${titleOf(dest)}: còn ${meters} m${accuracy}`;
  } else {
    $('nav-arrow').hidden = true;
    $('nav-text').textContent = `${titleOf(dest)}: đang xác định vị trí…`;
  }
}

function renderNowPlaying() {
  const playing = player.state !== 'idle' && player.poiId !== state.panelId ? poiById(player.poiId) : null;
  $('now-playing').hidden = !playing;
  if (playing) $('now-playing-text').textContent = `Đang phát: ${titleOf(playing)}`;
}

// poi-service hỏng thì không có ghim trên bản đồ: thay bằng hàng nút tên điểm để vẫn mở thẻ nghe hoặc đọc được.
function renderPoiList() {
  const container = $('poi-list');
  container.replaceChildren();
  if (state.degraded !== 'poi-service') return;
  for (const poi of state.pois) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = titleOf(poi);
    button.setAttribute('aria-pressed', String(poi.id === state.panelId));
    button.onclick = () => {
      openPanel(poi.id);
      render();
    };
    container.append(button);
  }
}

function renderPanel() {
  const poi = state.panelId ? poiById(state.panelId) : null;
  $('panel').hidden = !poi;
  if (!poi) return;
  const hasText = !!poi.text;
  $('panel-title').textContent = titleOf(poi);
  $('panel-text').textContent = hasText ? poi.text : NO_CONTENT_TEXT;
  const listenable = canListen(poi);
  // Điểm chưa có file mp3 thì luôn hiện chữ (hình thức "Nghe" cũng vậy), kèm dòng báo chưa có âm thanh.
  $('panel-text').hidden = hasText && listenable && state.mode === 'listen';
  $('panel-controls').hidden = !listenable || state.mode === 'read';
  $('panel-note').textContent = NO_AUDIO_TEXT;
  $('panel-note').hidden = !hasText || listenable || state.mode === 'read';

  const mine = player.poiId === poi.id ? player.state : 'idle';
  $('btn-play').disabled = mine === 'playing';
  $('btn-pause').disabled = mine !== 'playing';
  $('btn-stop').disabled = mine === 'idle';
  $('btn-replay').disabled = mine === 'idle';

  const isDest = state.destId === poi.id;
  const destButton = $('btn-dest');
  destButton.disabled = state.geoDenied || isDest || !hasCoords(poi);
  $('btn-dest-label').textContent = isDest ? 'Đang chỉ đường tới đây' : 'Chọn làm điểm đến';
  destButton.title = state.geoDenied ? 'Cần quyền vị trí để chỉ đường' : hasCoords(poi) ? '' : 'Chưa có vị trí của điểm này';
}

wakeServices();
loadLanguages();
