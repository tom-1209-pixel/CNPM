// Khoảng cách đường chim bay (haversine), đơn vị mét. Cùng công thức với gateway/public/js/geo.js.
export function distanceMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Hai điểm không được chồng bán kính (khoảng cách phải lớn hơn tổng hai bán kính). Trả điểm bị chồng, hoặc null.
export function findOverlap(poi, others) {
  return others.find((o) => o.id !== poi.id && distanceMeters(poi, o) <= poi.radius + o.radius) ?? null;
}

// Dời cả bộ điểm để tâm của chúng về target, giữ nguyên khoảng cách theo mét giữa các điểm.
// Không cộng thẳng độ kinh/vĩ: 1 độ kinh ngắn dần khi đi về phía bắc (cos vĩ độ), cộng thẳng thì các điểm co lại.
export function shiftPoints(points, target) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const center = { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lng: points.reduce((s, p) => s + p.lng, 0) / points.length };
  return points.map((p) => {
    const north = rad(p.lat - center.lat) * R;
    const east = rad(p.lng - center.lng) * R * Math.cos(rad(center.lat));
    return { id: p.id, lat: target.lat + deg(north / R), lng: target.lng + deg(east / (R * Math.cos(rad(target.lat)))) };
  });
}

// Lỗi dữ liệu một điểm (chuỗi tiếng Việt), hoặc null nếu hợp lệ.
export function poiError({ lat, lng, radius }) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Vĩ độ (lat) phải là số từ -90 tới 90';
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'Kinh độ (lng) phải là số từ -180 tới 180';
  if (!Number.isInteger(radius) || radius < 0) return 'Bán kính phải là số nguyên từ 0 m trở lên';
  return null;
}
