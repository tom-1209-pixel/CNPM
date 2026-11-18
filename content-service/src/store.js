const CONTENT = 'poi_id AS "poiId", lang, title, text';

export function createStore(pool) {
  return {
    // Trang du khách: chỉ ngôn ngữ không ẩn.
    async listLanguages() {
      const { rows } = await pool.query('SELECT code, name FROM languages WHERE NOT hidden ORDER BY sort_order');
      return rows;
    },
    // Trang quản lý: mọi ngôn ngữ kèm cột hidden.
    async listAllLanguages() {
      const { rows } = await pool.query('SELECT code, name, hidden FROM languages ORDER BY sort_order');
      return rows;
    },
    // Thêm vào cuối danh sách. Trả null nếu mã đã có.
    async addLanguage(code, name) {
      const { rows } = await pool.query(
        `INSERT INTO languages (code, name, sort_order)
         SELECT $1, $2, coalesce(max(sort_order), 0) + 1 FROM languages
         ON CONFLICT (code) DO NOTHING RETURNING code, name, hidden`,
        [code, name],
      );
      return rows[0] ?? null;
    },
    async updateLanguage(code, { name, hidden }) {
      const { rows } = await pool.query(
        'UPDATE languages SET name = $2, hidden = $3 WHERE code = $1 RETURNING code, name, hidden',
        [code, name, hidden],
      );
      return rows[0] ?? null;
    },
    async listContent(lang) {
      const { rows } = await pool.query(`SELECT ${CONTENT} FROM contents WHERE lang = $1 ORDER BY poi_id`, [lang]);
      return rows;
    },
    async listAllContent() {
      const { rows } = await pool.query(`SELECT ${CONTENT} FROM contents ORDER BY poi_id, lang`);
      return rows;
    },
    // Thêm mới hoặc ghi đè nội dung một điểm ở một ngôn ngữ.
    async saveContent(poiId, lang, title, text) {
      const { rows } = await pool.query(
        `INSERT INTO contents (poi_id, lang, title, text) VALUES ($1, $2, $3, $4)
         ON CONFLICT (poi_id, lang) DO UPDATE SET title = EXCLUDED.title, text = EXCLUDED.text
         RETURNING ${CONTENT}`,
        [poiId, lang, title, text],
      );
      return rows[0];
    },
    // lang bỏ trống: xóa nội dung mọi ngôn ngữ của điểm (khi xóa điểm). Trả số dòng đã xóa.
    async removeContent(poiId, lang) {
      const { rowCount } = lang
        ? await pool.query('DELETE FROM contents WHERE poi_id = $1 AND lang = $2', [poiId, lang])
        : await pool.query('DELETE FROM contents WHERE poi_id = $1', [poiId]);
      return rowCount;
    },
    async checkDb() {
      await pool.query('SELECT 1');
    },
  };
}
