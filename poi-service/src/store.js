const COLUMNS = 'id, lat, lng, radius, hidden';

export function createStore(pool) {
  return {
    // Trang du khách: chỉ điểm không ẩn, không cần cột hidden.
    async listPois() {
      const { rows } = await pool.query('SELECT id, lat, lng, radius FROM pois WHERE NOT hidden ORDER BY id');
      return rows;
    },
    // Trang quản lý: mọi điểm, kể cả điểm ẩn.
    async listAll() {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM pois ORDER BY id`);
      return rows;
    },
    // id tự sinh: poi-<số lớn nhất hiện có + 1>.
    async create({ lat, lng, radius }) {
      const { rows } = await pool.query(
        `INSERT INTO pois (id, lat, lng, radius)
         SELECT 'poi-' || (coalesce(max(substring(id FROM '^poi-([0-9]+)$')::int), 0) + 1), $1, $2, $3 FROM pois
         RETURNING ${COLUMNS}`,
        [lat, lng, radius],
      );
      return rows[0];
    },
    async update(id, { lat, lng, radius, hidden }) {
      const { rows } = await pool.query(
        `UPDATE pois SET lat = $2, lng = $3, radius = $4, hidden = $5 WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, lat, lng, radius, hidden],
      );
      return rows[0] ?? null;
    },
    async remove(id) {
      const { rowCount } = await pool.query('DELETE FROM pois WHERE id = $1', [id]);
      return rowCount > 0;
    },
    // Ghi vị trí mới cho nhiều điểm trong một câu lệnh (dùng khi dời cả bộ điểm).
    async moveAll(points) {
      const { rows } = await pool.query(
        `UPDATE pois SET lat = v.lat, lng = v.lng
         FROM (SELECT unnest($1::text[]) AS id, unnest($2::float8[]) AS lat, unnest($3::float8[]) AS lng) AS v
         WHERE pois.id = v.id RETURNING ${COLUMNS.split(', ').map((c) => `pois.${c}`).join(', ')}`,
        [points.map((p) => p.id), points.map((p) => p.lat), points.map((p) => p.lng)],
      );
      return rows.sort((a, b) => a.id.localeCompare(b.id));
    },
    async checkDb() {
      await pool.query('SELECT 1');
    },
  };
}
