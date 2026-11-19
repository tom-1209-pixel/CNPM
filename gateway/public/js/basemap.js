// Nền bản đồ (nhà, đường) là ảnh tải từ máy chủ bên ngoài. Nguồn chính là OpenStreetMap; một số mạng chặn tên miền
// openstreetmap.org nên có nguồn dự phòng là máy chủ ảnh của cộng đồng OSM Đức (cùng dữ liệu, tên miền khác).
// Cả hai đều lỗi thì báo (onChange(true)) thay vì để trống; tải được lại thì onChange(false).
// Dùng chung cho trang du khách và trang quản lý. L là Leaflet nạp từ CDN.
const BASE_LAYERS = [
  { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, attribution: '© OpenStreetMap contributors' } },
  { url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', options: { maxZoom: 18, attribution: '© OpenStreetMap contributors' } },
];

export function addBaseMap(map, onChange = () => {}, index = 0) {
  const layer = L.tileLayer(BASE_LAYERS[index].url, BASE_LAYERS[index].options).addTo(map);
  let active = true;
  let loaded = 0;
  let failed = 0;
  let reportedFailure = false;
  layer.on('tileload', () => {
    loaded++;
    if (reportedFailure) {
      reportedFailure = false;
      onChange(false);
    }
  });
  layer.on('tileerror', () => {
    failed++;
    if (!active || loaded > 0 || failed < 3) return;
    if (index + 1 < BASE_LAYERS.length) {
      active = false;
      layer.remove();
      addBaseMap(map, onChange, index + 1);
    } else if (!reportedFailure) {
      reportedFailure = true;
      onChange(true);
    }
  });
}
