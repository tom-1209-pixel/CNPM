// Tab Điểm tham quan và tab Ngôn ngữ của trang quản lý.
import { addBaseMap } from './basemap.js';

const $ = (id) => document.getElementById(id);
const DEFAULT_RADIUS = 30;

const pinIcon = (hidden) =>
  L.divIcon({
    className: hidden ? 'poi-pin hidden-poi' : 'poi-pin',
    html: '<svg viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37C15 37 2 25 2 14a13 13 0 0 1 26 0c0 11-13 23-13 23z" fill="currentColor" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>',
    iconSize: [30, 38],
    iconAnchor: [15, 37],
  });

// Lấy vị trí của máy đang mở trang quản lý. Thử GPS trước; máy tính không có GPS thì
// thường báo lỗi ngay, nên thử lại một lần bằng vị trí thường (Wi-Fi, mạng).
const getPosition = (options) =>
  new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));

const DENIED_TEXT = 'Trang chưa được phép dùng vị trí: bấm biểu tượng bên trái thanh địa chỉ → Vị trí → Cho phép, rồi thử lại.';
const UNAVAILABLE_TEXT = 'Máy chưa lấy được vị trí. Trên máy tính Windows: bật Cài đặt → Quyền riêng tư và bảo mật → Vị trí. '
  + 'Máy tính thường lệch hàng trăm mét; đặt điểm thật thì nên dùng điện thoại ở ngoài trời.';

async function myPosition() {
  if (!navigator.geolocation) throw new Error('Trình duyệt này không có định vị.');
  let p;
  try {
    p = await getPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  } catch (err) {
    if (err.code === err.PERMISSION_DENIED) throw new Error(DENIED_TEXT);
    try {
      p = await getPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
    } catch (again) {
      throw new Error(again.code === again.PERMISSION_DENIED ? DENIED_TEXT : UNAVAILABLE_TEXT);
    }
  }
  return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
}

// api(path, { method, body }): gọi /api/admin/<path> kèm mật khẩu. toast(text, isError). onNames(names): báo tên điểm,
// tên ngôn ngữ cho tab Thống kê.
export function initPois({ api, toast, onNames }) {
  let pois = [];
  let languages = [];
  let selected = null; // id điểm đang sửa, 'new' khi đang thêm, null khi không sửa gì
  // minZoom 3: không thu nhỏ tới mức thấy nhiều bản sao thế giới (bấm vào bản sao cho kinh độ ngoài [-180, 180]).
  const map = L.map('admin-map', { minZoom: 3, worldCopyJump: true }).setView([10.7769, 106.7009], 16);
  addBaseMap(map);
  const poiLayer = L.layerGroup().addTo(map);
  const editLayer = L.layerGroup().addTo(map);
  const titleOf = (poi) => poi.content.vi?.title ?? poi.id;

  async function load() {
    [pois, languages] = await Promise.all([api('/pois'), api('/languages')]);
    onNames({
      pois: Object.fromEntries(pois.map((p) => [p.id, titleOf(p)])),
      languages: Object.fromEntries(languages.map((l) => [l.code, l.name])),
    });
    drawMap();
    renderList();
  }

  // Điểm đang sửa vẽ riêng (ghim kéo được, vòng theo ô bán kính); các điểm khác chỉ bấm được để chọn.
  function drawMap() {
    poiLayer.clearLayers();
    for (const poi of pois) {
      if (poi.id === selected) continue;
      L.circle([poi.lat, poi.lng], { radius: poi.radius, color: poi.hidden ? '#94a3b8' : '#2563eb', weight: 2, fillOpacity: poi.hidden ? 0.06 : 0.16, interactive: false }).addTo(poiLayer);
      L.marker([poi.lat, poi.lng], { icon: pinIcon(poi.hidden) })
        .addTo(poiLayer)
        .bindTooltip(`${titleOf(poi)}${poi.hidden ? ' (ẩn)' : ''}`, { permanent: true, direction: 'top', offset: [0, -34], className: 'poi-label' })
        .on('click', () => select(poi.id));
    }
    drawEdit();
  }

  function drawEdit() {
    editLayer.clearLayers();
    if (!selected) return;
    const lat = Number($('f-lat').value);
    const lng = Number($('f-lng').value);
    const radius = Math.max(Number($('f-radius').value) || 0, 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    L.circle([lat, lng], { radius, color: '#f97316', weight: 3, fillOpacity: 0.18, interactive: false }).addTo(editLayer);
    L.marker([lat, lng], { icon: pinIcon($('f-hidden').checked), draggable: true, autoPan: true })
      .addTo(editLayer)
      .on('dragend', (e) => {
        const p = e.target.getLatLng().wrap();
        $('f-lat').value = p.lat.toFixed(6);
        $('f-lng').value = p.lng.toFixed(6);
        drawEdit();
      });
  }

  function renderList() {
    const list = $('poi-list');
    if (pois.length === 0) {
      const li = document.createElement('li');
      li.className = 'poi-empty';
      li.textContent = 'Chưa có điểm nào. Bấm lên bản đồ để thêm.';
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(
      ...pois.map((poi) => {
        const li = document.createElement('li');
        li.setAttribute('aria-selected', String(poi.id === selected));
        const name = document.createElement('span');
        name.textContent = titleOf(poi);
        if (poi.hidden) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = 'ẩn';
          name.append(badge);
        }
        const meta = document.createElement('span');
        meta.className = 'poi-meta';
        meta.textContent = `${poi.id} · ${poi.radius} m · ${Object.keys(poi.content).join(', ') || 'chưa có nội dung'}`;
        li.append(name, meta);
        li.onclick = () => select(poi.id);
        return li;
      }),
    );
  }

  // Mỗi ngôn ngữ một khối tên + nội dung. Tiếng Việt bắt buộc.
  function renderContents(content) {
    $('f-contents').replaceChildren(
      ...languages.map((lang) => {
        const block = document.createElement('div');
        block.className = 'lang-block';
        block.dataset.lang = lang.code;
        const h = document.createElement('h3');
        h.textContent = `${lang.name} (${lang.code})${lang.code === 'vi' ? ' – bắt buộc' : ''}${lang.hidden ? ' – ngôn ngữ đang ẩn' : ''}`;
        const titleLabel = document.createElement('label');
        titleLabel.textContent = 'Tên điểm';
        const title = document.createElement('input');
        title.maxLength = 200;
        title.value = content[lang.code]?.title ?? '';
        titleLabel.append(title);
        const textLabel = document.createElement('label');
        textLabel.textContent = 'Nội dung thuyết minh';
        const text = document.createElement('textarea');
        text.maxLength = 5000;
        text.value = content[lang.code]?.text ?? '';
        textLabel.append(text);
        block.append(h, titleLabel, textLabel);
        return block;
      }),
    );
  }

  // Ô bán kính báo cùng câu với poi-service, thay cho câu mặc định của trình duyệt.
  function checkRadius() {
    const value = $('f-radius').value;
    const ok = value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0;
    $('f-radius').setCustomValidity(ok ? '' : 'Bán kính phải là số nguyên từ 0 m trở lên');
  }

  function openForm(poi) {
    $('poi-form').hidden = false;
    $('poi-error').hidden = true;
    $('poi-form-title').textContent = poi.id ? `Sửa điểm ${poi.id}` : 'Thêm điểm mới';
    $('f-lat').value = poi.lat.toFixed(6);
    $('f-lng').value = poi.lng.toFixed(6);
    $('f-radius').value = poi.radius;
    checkRadius();
    $('f-hidden').checked = poi.hidden;
    $('btn-delete').hidden = !poi.id;
    renderContents(poi.content);
    drawMap();
    renderList();
    $('poi-form').scrollIntoView({ block: 'nearest' });
  }

  function select(id) {
    selected = id;
    openForm(pois.find((p) => p.id === id));
  }

  function newDraft({ lat, lng }) {
    selected = 'new';
    openForm({ id: null, lat, lng, radius: DEFAULT_RADIUS, hidden: false, content: {} });
  }

  function close() {
    selected = null;
    $('poi-form').hidden = true;
    drawMap();
    renderList();
  }

  function showError(message) {
    $('poi-error').textContent = message;
    $('poi-error').hidden = false;
  }

  async function save(event) {
    event.preventDefault();
    const fields = { lat: Number($('f-lat').value), lng: Number($('f-lng').value), radius: Number($('f-radius').value), hidden: $('f-hidden').checked };
    const content = {};
    for (const block of $('f-contents').children) {
      const [title, text] = block.querySelectorAll('input, textarea');
      content[block.dataset.lang] = { title: title.value.trim(), text: text.value.trim() };
    }
    if (!content.vi?.title || !content.vi?.text) return showError('Cần tên và nội dung Tiếng Việt (bản dùng khi thiếu ngôn ngữ khác).');
    const filled = Object.fromEntries(Object.entries(content).filter(([, c]) => c.title && c.text));
    const half = Object.entries(content).find(([, c]) => Boolean(c.title) !== Boolean(c.text));
    if (half) return showError(`Ngôn ngữ ${half[0]}: cần nhập cả tên và nội dung, hoặc để trống cả hai.`);
    const button = $('poi-form').querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      let id = selected;
      if (selected === 'new') {
        const created = await api('/pois', { method: 'POST', body: { lat: fields.lat, lng: fields.lng, radius: fields.radius, content: filled } });
        id = created.id;
        if (fields.hidden) await api(`/pois/${id}`, { method: 'PUT', body: { hidden: true } });
        if (created.contentError) toast(`Đã thêm điểm nhưng chưa lưu được nội dung: ${created.contentError}`, true);
      } else {
        const before = pois.find((p) => p.id === selected);
        if (['lat', 'lng', 'radius', 'hidden'].some((k) => before[k] !== fields[k])) await api(`/pois/${id}`, { method: 'PUT', body: fields });
        for (const [lang, c] of Object.entries(content)) {
          const old = before.content[lang];
          if (c.title && c.text && (old?.title !== c.title || old?.text !== c.text)) await api(`/pois/${id}/content/${lang}`, { method: 'PUT', body: c });
          if (!c.title && !c.text && old) await api(`/pois/${id}/content/${lang}`, { method: 'DELETE' });
        }
      }
      toast('Đã lưu');
      selected = id;
      await load();
      select(id);
    } catch (err) {
      showError(err.message);
      if (selected !== 'new') await load().catch(() => {});
    } finally {
      button.disabled = false;
    }
  }

  async function remove() {
    if (!confirm(`Xóa điểm ${selected} và toàn bộ nội dung của nó? Không hoàn tác được.`)) return;
    try {
      await api(`/pois/${selected}`, { method: 'DELETE' });
      toast('Đã xóa điểm');
      close();
      await load();
    } catch (err) {
      showError(err.message);
    }
  }

  async function useMyLocation() {
    try {
      const pos = await myPosition();
      map.setView([pos.lat, pos.lng], 18);
      newDraft(pos);
      toast(`Đã đặt điểm mới tại vị trí của bạn (sai số ~${Math.round(pos.accuracy)} m)`);
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function shiftHere() {
    if (pois.length === 0) return toast('Chưa có điểm nào để dời.', true);
    try {
      const pos = await myPosition();
      const warn = pos.accuracy > 100 ? `\nLưu ý: vị trí đang sai số khoảng ${Math.round(pos.accuracy)} m.` : '';
      if (!confirm(`Dời cả ${pois.length} điểm tới quanh vị trí của bạn? Khoảng cách giữa các điểm giữ nguyên.${warn}`)) return;
      await api('/pois/shift', { method: 'POST', body: { lat: pos.lat, lng: pos.lng } });
      close();
      await load();
      map.fitBounds(L.latLngBounds(pois.map((p) => [p.lat, p.lng])).pad(0.4), { maxZoom: 18 });
      toast('Đã dời cả bộ điểm tới chỗ bạn');
    } catch (err) {
      toast(err.message, true);
    }
  }

  map.on('click', (e) => {
    const p = e.latlng.wrap(); // đưa kinh độ về [-180, 180]
    newDraft({ lat: p.lat, lng: p.lng });
  });
  for (const id of ['f-lat', 'f-lng', 'f-radius', 'f-hidden']) $(id).addEventListener('input', drawEdit);
  $('f-radius').addEventListener('input', checkRadius);
  $('poi-form').onsubmit = save;
  $('btn-delete').onclick = remove;
  $('btn-cancel').onclick = close;
  $('btn-my-location').onclick = useMyLocation;
  $('btn-shift').onclick = shiftHere;
  $('btn-preview').onclick = () => window.open('/?sim=1', '_blank', 'noopener');

  let fitted = false;
  return {
    async reload() {
      await load();
      // Lần đầu: thu bản đồ vừa đủ các điểm.
      if (!fitted && pois.length > 0) {
        fitted = true;
        map.fitBounds(L.latLngBounds(pois.map((p) => [p.lat, p.lng])).pad(0.3), { maxZoom: 18 });
      }
    },
    // Bản đồ nằm trong tab đang ẩn thì Leaflet không biết kích thước: gọi lại khi mở tab.
    resize: () => map.invalidateSize(),
  };
}

export function initLanguages({ api, toast, onChange }) {
  const showError = (message) => {
    $('lang-error').textContent = message;
    $('lang-error').hidden = !message;
  };

  async function load() {
    const languages = await api('/languages');
    $('lang-rows').replaceChildren(
      ...languages.map((lang) => {
        const tr = document.createElement('tr');
        const code = document.createElement('td');
        code.textContent = lang.code;
        const nameCell = document.createElement('td');
        const name = document.createElement('input');
        name.value = lang.name;
        name.maxLength = 50;
        nameCell.append(name);
        const hiddenCell = document.createElement('td');
        const hidden = document.createElement('input');
        hidden.type = 'checkbox';
        hidden.checked = lang.hidden;
        hidden.disabled = lang.code === 'vi';
        hidden.title = lang.code === 'vi' ? 'Không ẩn được Tiếng Việt' : 'Ẩn khỏi trang du khách';
        hiddenCell.append(hidden);
        const actionCell = document.createElement('td');
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Lưu';
        save.onclick = async () => {
          try {
            await api(`/languages/${lang.code}`, { method: 'PUT', body: { name: name.value, hidden: hidden.checked } });
            showError('');
            toast(`Đã lưu ngôn ngữ ${lang.code}`);
            await load();
            onChange();
          } catch (err) {
            showError(err.message);
          }
        };
        actionCell.append(save);
        tr.append(code, nameCell, hiddenCell, actionCell);
        return tr;
      }),
    );
  }

  $('lang-form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/languages', { method: 'POST', body: { code: $('lang-code').value.trim(), name: $('lang-name').value.trim() } });
      $('lang-form').reset();
      showError('');
      toast('Đã thêm ngôn ngữ. Nhập nội dung cho từng điểm ở tab Điểm tham quan.');
      await load();
      onChange();
    } catch (err) {
      showError(err.message);
    }
  };

  return { reload: load };
}
