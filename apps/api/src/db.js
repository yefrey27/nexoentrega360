import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// Ejecuta fn dentro de una transacción. Si fn lanza, hace ROLLBACK.
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* ignorar */ }
    throw e;
  } finally {
    c.release();
  }
}
