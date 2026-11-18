import pg from 'pg';

// Mặc định là DB "poi-db" trong docker-compose, mở ra máy dev ở cổng 5433.
export const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/poi';

export function createPool(connectionString = process.env.DATABASE_URL || DEFAULT_DATABASE_URL) {
  // Chờ kết nối có giới hạn: DB hỏng thì trả lỗi để gateway xử lý, không treo yêu cầu.
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
  // Neon tự đóng kết nối đang rảnh; lỗi trên kết nối rảnh không được làm sập service.
  pool.on('error', (err) => console.error(`DB: ${err.message}`));
  return pool;
}
