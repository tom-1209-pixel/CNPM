// Thống kê tính theo giờ Việt Nam.
const TZ = 'Asia/Ho_Chi_Minh';
// Đang online: chưa báo rời và còn báo "còn mở" trong khoảng này (trang báo mỗi 30 giây, tab nền có thể chậm tới 1 phút).
const ONLINE = `ended_at IS NULL AND last_seen_at > now() - interval '2 minutes'`;
// Khoảng thời gian của danh sách lượt trên trang thống kê.
export const RANGES = {
  '1h': `started_at > now() - interval '1 hour'`,
  today: `date_trunc('day', started_at AT TIME ZONE '${TZ}') = date_trunc('day', now() AT TIME ZONE '${TZ}')`,
  '7d': `started_at > now() - interval '7 days'`,
  '30d': `started_at > now() - interval '30 days'`,
};
const MAX_VISITS = 500;
const MAX_CHANGES = 200;

export function createStore(pool) {
  return {
    async recordVisit(id, lang) {
      await pool.query('INSERT INTO visits (id, lang) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [id, lang]);
    },
    // Trả false khi không có lượt này (chưa ghi được lúc mở trang).
    async ping(id, lang) {
      const { rowCount } = await pool.query(
        'UPDATE visits SET last_seen_at = now(), lang = COALESCE($2, lang), ended_at = NULL WHERE id = $1',
        [id, lang ?? null],
      );
      return rowCount > 0;
    },
    async leave(id) {
      const { rowCount } = await pool.query('UPDATE visits SET last_seen_at = now(), ended_at = now() WHERE id = $1', [id]);
      return rowCount > 0;
    },
    async recordEvent(visitId, poiId, kind) {
      await pool.query('INSERT INTO poi_events (visit_id, poi_id, kind) VALUES ($1, $2, $3)', [visitId, poiId, kind]);
    },
    async recordChange(action, target, detail) {
      const { rows } = await pool.query(
        'INSERT INTO changes (action, target, detail) VALUES ($1, $2, $3) RETURNING id, at, action, target, detail',
        [action, target, detail],
      );
      return rows[0];
    },
    async listChanges() {
      const { rows } = await pool.query(`SELECT id, at, action, target, detail FROM changes ORDER BY at DESC, id DESC LIMIT ${MAX_CHANGES}`);
      return rows;
    },
    async checkDb() {
      await pool.query('SELECT 1');
    },
    async stats(range = 'today') {
      // poi_events dùng cột at thay cho started_at trong điều kiện khoảng thời gian
      const eventRange = RANGES[range].replaceAll('started_at', 'at');
      const [summary, visits, byPoi] = await Promise.all([
        pool.query(
          `SELECT
             count(*) FILTER (WHERE ${ONLINE})::int AS online,
             count(*) FILTER (WHERE ${RANGES.today})::int AS today,
             count(*) FILTER (WHERE ${RANGES['30d']})::int AS "last30Days",
             coalesce(round(avg(extract(epoch FROM coalesce(ended_at, last_seen_at) - started_at) / 60)
               FILTER (WHERE ${RANGES['30d']}), 1), 0)::float AS "avgMinutes"
           FROM visits`,
        ),
        // code: 5 ký tự đầu của id, chỉ để phân biệt các lượt trên trang thống kê
        pool.query(
          `SELECT left(id::text, 5) AS code, lang, started_at AS "startedAt",
                  coalesce(ended_at, last_seen_at) AS "lastSeenAt", (${ONLINE}) AS online
           FROM visits WHERE ${RANGES[range]}
           ORDER BY started_at DESC LIMIT ${MAX_VISITS}`,
        ),
        // Theo điểm: số lần mở thẻ, số lần nghe, nhiều nhất trước
        pool.query(
          `SELECT poi_id AS "poiId",
                  count(*) FILTER (WHERE kind = 'open')::int AS opens,
                  count(*) FILTER (WHERE kind = 'play')::int AS plays
           FROM poi_events WHERE ${eventRange}
           GROUP BY poi_id ORDER BY count(*) DESC, poi_id`,
        ),
      ]);
      return { ...summary.rows[0], visits: visits.rows, byPoi: byPoi.rows };
    },
  };
}
