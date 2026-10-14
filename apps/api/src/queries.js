import { pool } from './db.js';
import { auditRow } from './audit.js';
import { STATUSES, paging, wrap } from './http.js';

export const dashboard = wrap(async (req, res) => {
  const o = req.user.orgId;
  const counts = await pool.query('SELECT status, count(*)::int AS n FROM requests WHERE org_id = $1 GROUP BY status', [o]);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  counts.rows.forEach((r) => { byStatus[r.status] = r.n; });
  const inv = await pool.query(
    `SELECT s.code AS sku, coalesce(i.on_hand,0) AS "onHand", coalesce(i.reserved,0) AS reserved
       FROM skus s LEFT JOIN inventory i ON i.sku_id = s.id AND i.org_id = $1 WHERE s.active ORDER BY s.code`, [o]);
  res.json({ byStatus, inventory: inv.rows.map((r) => ({ ...r, available: r.onHand - r.reserved })) });
});

export const listAudit = wrap(async (req, res) => {
  const o = req.user.orgId;
  const { page, pageSize, offset } = paging(req.query);
  const total = Number((await pool.query('SELECT count(*) FROM audit_events WHERE org_id = $1', [o])).rows[0].count);
  const { rows } = await pool.query(
    'SELECT * FROM audit_events WHERE org_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT $2 OFFSET $3', [o, pageSize, offset]);
  res.json({ items: rows.map(auditRow), total, page, pageSize });
});
