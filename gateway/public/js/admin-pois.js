// Tab Điểm tham quan (nhóm CN8: thêm, sửa, ẩn/hiện, xóa, dời cả bộ, xem điểm) và
// tab Ngôn ngữ (nhóm CN9: sửa ngôn ngữ gồm tên ngôn ngữ, nội dung các điểm và âm thanh; thêm, ẩn/hiện, xem ngôn ngữ).
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

const titleOf = (poi) => poi.content.vi?.title ?? poi.id;

// Chip ngôn ngữ: có âm thanh / có chữ nhưng chưa có âm thanh / chưa có nội dung.
function langChip(code, content) {
  const chip = document.createElement('span');
  chip.className = content ? (content.audio ? 'lang-chip' : 'lang-chip no-audio') : 'lang-chip empty';
  chip.textContent = code;
  chip.title = content ? (content.audio ? 'Có âm thanh' : 'Có chữ, chưa có âm thanh') : 'Chưa có nội dung';
  return chip;
}

// ---------- Nhóm CN8: Quản lý điểm tham quan ----------

// api(path, { method, body }): gọi /api/admin/<path> kèm mật khẩu. toast(text, isError). onNames(names): báo tên điểm,
// tên ngôn ngữ cho tab Thống kê. onChange(): báo tab Ngôn ngữ tải lại sau khi điểm đổi.
export function initPois({ api, toast, onNames, onChange = () => {} }) {
  let pois = [];
  let languages = [];
  let selected = null; // id điểm đang sửa, 'new' khi đang thêm, null khi không sửa gì
  // minZoom 3: không thu nhỏ tới mức thấy nhiều bản sao thế giới (bấm vào bản sao cho kinh độ ngoài [-180, 180]).
  const map = L.map('admin-map', { minZoom: 3, worldCopyJump: true }).setView([10.7769, 106.7009], 16);
  addBaseMap(map);
  const poiLayer = L.layerGroup().addTo(map);
  const editLayer = L.layerGroup().addTo(map);

  async function load() {
    [pois, languages] = await Promise.all([api('/pois'), api('/languages')]);
    onNames({
      pois: Object.fromEntries(pois.map((p) => [p.id, titleOf(p)])),
      languages: Object.fromEntries(languages.map((l) => [l.code, l.name])),
    });
    drawMap();
    renderList();
  }

  // CN8.6 Xem điểm. Điểm đang sửa vẽ riêng (ghim kéo được, vòng theo ô bán kính); các điểm khác chỉ bấm được để chọn.
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
    $('poi-count').textContent = `${pois.length} điểm`;
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
        name.className = 'poi-name';
        const dot = document.createElement('span');
        dot.className = poi.hidden ? 'poi-dot off' : 'poi-dot';
        name.append(dot, titleOf(poi));
        if (poi.hidden) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = 'ẩn';
          name.append(badge);
        }
        const meta = document.createElement('span');
        meta.className = 'poi-meta';
        meta.append(`${poi.id} · ${poi.radius} m`, ...languages.map((l) => langChip(l.code, poi.content[l.code])));
        li.append(name, meta);
        li.onclick = () => select(poi.id);
        return li;
      }),
    );
  }

  // Ô bán kính báo cùng câu với poi-service, thay cho câu mặc định của trình duyệt.
  function checkRadius() {
    const value = $('f-radius').value;
    const ok = value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0;
    $('f-radius').setCustomValidity(ok ? '' : 'Bán kính phải là số nguyên từ 0 m trở lên');
  }

  // Form thay chỗ danh sách trong ngăn bên phải; đóng form thì danh sách hiện lại.
  // Form chỉ có vị trí, bán kính, ẩn và tên Tiếng Việt. Ô nội dung Tiếng Việt chỉ hiện khi thêm điểm
  // (hoặc điểm chưa có bản Tiếng Việt), vì điểm phải có bản Tiếng Việt thì du khách mới thấy.
  function openForm(poi) {
    $('poi-browse').hidden = true;
    $('poi-form').hidden = false;
    $('poi-error').hidden = true;
    $('poi-form-title').textContent = poi.id ? titleOf(poi) : 'Thêm điểm mới';
    $('poi-form-sub').textContent = poi.id ? `Mã ${poi.id}` : 'Chưa lưu';
    $('f-lat').value = poi.lat.toFixed(6);
    $('f-lng').value = poi.lng.toFixed(6);
    $('f-radius').value = poi.radius;
    checkRadius();
    $('f-hidden').checked = poi.hidden;
    $('f-title').value = poi.content.vi?.title ?? '';
    const needText = !poi.content.vi;
    $('f-text-wrap').hidden = !needText;
    $('f-text').required = needText;
    $('f-text').value = '';
    $('f-lang-note').hidden = !poi.id;
    $('btn-delete').hidden = !poi.id;
    drawMap();
    renderList();
    $('poi-side').scrollIntoView({ block: 'nearest' });
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
    $('poi-browse').hidden = false;
    drawMap();
    renderList();
  }

  function showError(message) {
    $('poi-error').textContent = message;
    $('poi-error').hidden = false;
  }

  // CN8.1 Thêm điểm, CN8.2 Sửa điểm (vị trí, bán kính, tên điểm), CN8.3 Ẩn/hiện điểm.
  async function save(event) {
    event.preventDefault();
    const fields = { lat: Number($('f-lat').value), lng: Number($('f-lng').value), radius: Number($('f-radius').value), hidden: $('f-hidden').checked };
    const title = $('f-title').value.trim();
    const text = $('f-text').value.trim();
    const needText = !$('f-text-wrap').hidden;
    if (!title) return showError('Cần tên điểm Tiếng Việt.');
    if (needText && !text) return showError('Cần nội dung Tiếng Việt (bản dùng khi thiếu ngôn ngữ khác).');
    const button = $('poi-form').querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      let id = selected;
      let audioProblem = null; // chữ đã lưu nhưng tạo âm thanh lỗi
      if (selected === 'new') {
        toast('Đang lưu và tạo âm thanh…');
        const created = await api('/pois', { method: 'POST', body: { lat: fields.lat, lng: fields.lng, radius: fields.radius, content: { vi: { title, text } } } });
        id = created.id;
        if (fields.hidden) await api(`/pois/${id}`, { method: 'PUT', body: { hidden: true } });
        if (created.contentError) toast(`Đã thêm điểm nhưng chưa lưu được nội dung: ${created.contentError}`, true);
        else if (created.audioError) audioProblem = created.audioError;
      } else {
        const before = pois.find((p) => p.id === selected);
        if (['lat', 'lng', 'radius', 'hidden'].some((k) => before[k] !== fields[k])) await api(`/pois/${id}`, { method: 'PUT', body: fields });
        const vi = before.content.vi;
        if (!vi || vi.title !== title) {
          // Chỉ đổi tên thì giữ nguyên nội dung (content-service không tạo lại mp3).
          const saved = await api(`/pois/${id}/content/vi`, { method: 'PUT', body: { title, text: vi ? vi.text : text } });
          if (saved.audioError) audioProblem = saved.audioError;
        }
      }
      if (audioProblem) toast(`Đã lưu nhưng chưa tạo được âm thanh (${audioProblem}). Tạo lại ở mục Ngôn ngữ.`, true);
      else toast('Đã lưu');
      selected = id;
      await load();
      select(id);
      onChange();
    } catch (err) {
      showError(err.message);
      if (selected !== 'new') await load().catch(() => {});
    } finally {
      button.disabled = false;
    }
  }

  // CN8.4 Xóa điểm.
  async function remove() {
    if (!confirm(`Xóa điểm ${selected} và toàn bộ nội dung của nó? Không hoàn tác được.`)) return;
    try {
      await api(`/pois/${selected}`, { method: 'DELETE' });
      toast('Đã xóa điểm');
      close();
      await load();
      onChange();
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

  // CN8.5 Dời cả bộ điểm.
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
      if (selected && selected !== 'new' && pois.some((p) => p.id === selected)) select(selected);
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

// ---------- Nhóm CN9: Quản lý ngôn ngữ ----------

export function initLanguages({ api, toast, onChange }) {
  let languages = [];
  let pois = [];
  let editing = null; // mã ngôn ngữ đang sửa nội dung, null khi khung sửa đóng

  const showError = (message) => {
    $('lang-error').textContent = message;
    $('lang-error').hidden = !message;
  };

  async function load() {
    [languages, pois] = await Promise.all([api('/languages'), api('/pois')]);
    renderTable();
    if (editing && !languages.some((l) => l.code === editing)) editing = null;
    renderEditor();
  }

  // CN9.4 Xem ngôn ngữ; tên và ô "Ẩn" sửa ngay trên dòng (CN9.1 tên ngôn ngữ, CN9.3 ẩn/hiện).
  function renderTable() {
    $('lang-rows').replaceChildren(
      ...languages.map((lang) => {
        const tr = document.createElement('tr');
        if (lang.code === editing) tr.className = 'editing';
        const code = document.createElement('td');
        const codeText = document.createElement('span');
        codeText.className = 'code';
        codeText.textContent = lang.code;
        code.append(codeText);
        const nameCell = document.createElement('td');
        const name = document.createElement('input');
        name.value = lang.name;
        name.maxLength = 50;
        name.setAttribute('aria-label', `Tên ngôn ngữ ${lang.code}`);
        nameCell.append(name);
        const hiddenCell = document.createElement('td');
        const hidden = document.createElement('input');
        hidden.type = 'checkbox';
        hidden.checked = lang.hidden;
        hidden.disabled = lang.code === 'vi';
        hidden.title = lang.code === 'vi' ? 'Không ẩn được Tiếng Việt' : 'Ẩn khỏi trang du khách';
        hiddenCell.append(hidden);
        // Số điểm đã có nội dung, đã có âm thanh ở ngôn ngữ này.
        const countCell = document.createElement('td');
        const filled = pois.filter((p) => p.content[lang.code]);
        const voiced = filled.filter((p) => p.content[lang.code].audio);
        countCell.className = 'muted lang-count';
        countCell.textContent = `${filled.length}/${pois.length} điểm · ${voiced.length} có âm thanh`;
        const actionCell = document.createElement('td');
        actionCell.className = 'row-actions';
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
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'primary';
        edit.textContent = 'Sửa nội dung';
        edit.onclick = () => {
          editing = lang.code;
          renderTable();
          renderEditor();
          $('lang-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        actionCell.append(save, edit);
        tr.append(code, nameCell, hiddenCell, countCell, actionCell);
        return tr;
      }),
    );
  }

  // Dòng âm thanh của một nội dung đã lưu: nghe thử hoặc báo chưa có; nút tạo lại.
  function audioRow(poi, lang, hasAudio) {
    const row = document.createElement('div');
    row.className = hasAudio ? 'audio-row' : 'audio-row missing';
    const state = document.createElement('span');
    state.textContent = hasAudio ? 'Âm thanh:' : 'Chưa có âm thanh (chữ mới sửa hoặc tạo lỗi).';
    row.append(state);
    if (hasAudio) {
      const player = document.createElement('audio');
      player.controls = true;
      player.preload = 'none';
      player.src = `/api/audio/${encodeURIComponent(poi.id)}/${encodeURIComponent(lang)}?t=${Date.now()}`;
      row.append(player);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = hasAudio ? 'Tạo lại âm thanh' : 'Tạo âm thanh';
    button.onclick = async () => {
      button.disabled = true;
      toast('Đang tạo âm thanh…');
      try {
        await api(`/pois/${poi.id}/content/${lang}/audio`, { method: 'POST' });
        toast('Đã tạo âm thanh');
        await load();
        onChange();
      } catch (err) {
        toast(err.message, true);
        button.disabled = false;
      }
    };
    row.append(button);
    return row;
  }

  // Một điểm trong khung sửa nội dung: tên, nội dung, âm thanh và nút Lưu riêng.
  function poiBlock(poi, lang) {
    const c = poi.content[lang.code];
    const block = document.createElement('form');
    block.className = 'lang-poi';
    const head = document.createElement('div');
    head.className = 'lang-poi-head';
    const name = document.createElement('strong');
    name.textContent = titleOf(poi);
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = poi.id + (poi.hidden ? ' · điểm đang ẩn' : '');
    head.append(name, meta, langChip(lang.code, c));
    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Tên điểm';
    const title = document.createElement('input');
    title.maxLength = 200;
    title.value = c?.title ?? '';
    titleLabel.append(title);
    const textLabel = document.createElement('label');
    textLabel.textContent = 'Nội dung thuyết minh';
    const text = document.createElement('textarea');
    text.maxLength = 5000;
    text.value = c?.text ?? '';
    textLabel.append(text);
    block.append(head, titleLabel, textLabel);
    // Ngôn ngữ khác Tiếng Việt: hiện bản Tiếng Việt để dịch theo.
    if (lang.code !== 'vi' && poi.content.vi) {
      const ref = document.createElement('p');
      ref.className = 'lang-ref';
      ref.textContent = `Bản Tiếng Việt: ${poi.content.vi.title}. ${poi.content.vi.text}`;
      block.append(ref);
    }
    if (c) block.append(audioRow(poi, lang.code, c.audio));
    const error = document.createElement('p');
    error.className = 'form-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const actions = document.createElement('div');
    actions.className = 'lang-poi-actions';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'primary';
    save.textContent = 'Lưu';
    actions.append(save);
    block.append(error, actions);
    block.onsubmit = async (event) => {
      event.preventDefault();
      const t = title.value.trim();
      const x = text.value.trim();
      error.hidden = true;
      const fail = (message) => {
        error.textContent = message;
        error.hidden = false;
      };
      if (Boolean(t) !== Boolean(x)) return fail('Cần nhập cả tên và nội dung, hoặc để trống cả hai để xóa bản ngôn ngữ này.');
      if (!t && lang.code === 'vi') return fail('Không xóa được bản Tiếng Việt (bản dùng khi thiếu ngôn ngữ khác).');
      if (!t && !c) return fail('Chưa nhập gì.');
      if (c && c.title === t && c.text === x) return toast('Không có gì thay đổi');
      save.disabled = true;
      try {
        if (!t) {
          await api(`/pois/${poi.id}/content/${lang.code}`, { method: 'DELETE' });
          toast(`Đã xóa bản ${lang.code} của ${poi.id}`);
        } else {
          toast('Đang lưu và tạo âm thanh…');
          const saved = await api(`/pois/${poi.id}/content/${lang.code}`, { method: 'PUT', body: { title: t, text: x } });
          if (saved.audioError) toast(`Đã lưu chữ nhưng chưa tạo được âm thanh (${saved.audioError}). Bấm "Tạo âm thanh" để thử lại.`, true);
          else toast('Đã lưu');
        }
        await load();
        onChange();
      } catch (err) {
        fail(err.message);
        save.disabled = false;
      }
    };
    return block;
  }

  // CN9.1 Sửa ngôn ngữ: tên và nội dung của mọi điểm bằng ngôn ngữ đang chọn, nghe thử, tạo lại âm thanh.
  function renderEditor() {
    const lang = languages.find((l) => l.code === editing);
    $('lang-editor').hidden = !lang;
    if (!lang) return;
    $('lang-editor-title').textContent = `Nội dung: ${lang.name} (${lang.code})`;
    $('lang-editor-sub').textContent = lang.code === 'vi'
      ? 'Bản Tiếng Việt bắt buộc, dùng khi thiếu ngôn ngữ khác.'
      : 'Để trống cả tên và nội dung rồi bấm Lưu để xóa bản ngôn ngữ này của một điểm.';
    if (pois.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = 'Chưa có điểm nào. Thêm điểm ở mục Điểm tham quan.';
      $('lang-editor-list').replaceChildren(empty);
      return;
    }
    $('lang-editor-list').replaceChildren(...pois.map((poi) => poiBlock(poi, lang)));
  }

  // CN9.2 Thêm ngôn ngữ.
  $('lang-form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const code = $('lang-code').value.trim();
      await api('/languages', { method: 'POST', body: { code, name: $('lang-name').value.trim() } });
      $('lang-form').reset();
      showError('');
      toast('Đã thêm ngôn ngữ. Nhập nội dung cho từng điểm ở khung bên dưới.');
      editing = code;
      await load();
      onChange();
    } catch (err) {
      showError(err.message);
    }
  };

  $('lang-editor-close').onclick = () => {
    editing = null;
    renderTable();
    renderEditor();
  };

  // Tạo mp3 cho mọi nội dung chưa có hoặc đã cũ (nội dung mẫu, hoặc lần trước edge-tts lỗi).
  $('btn-rebuild-audio').onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    toast('Đang tạo âm thanh còn thiếu, có thể mất vài chục giây…');
    try {
      const { created, failed } = await api('/audio/rebuild', { method: 'POST' });
      if (failed.length) toast(`Đã tạo ${created.length}, lỗi ${failed.length}: ${failed[0].id} (${failed[0].error})`, true);
      else toast(created.length ? `Đã tạo âm thanh cho ${created.length} nội dung` : 'Mọi nội dung đã có âm thanh');
      await load();
      onChange();
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  };

  return { reload: load };
}
