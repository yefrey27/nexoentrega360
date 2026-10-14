import { pool, tx } from './db.js';
import { audit, auditRow } from './audit.js';
import { HttpError, ZONES, PRIORITIES, STATUSES, isUuid, paging, wrap } from './http.js';

const REQ_COLS = `r.id, r.code, r.status, r.zone, r.priority, to_char(r.required_date,'YYYY-MM-DD') AS "requiredDate",
                  r.notes, r.requester_id AS "requesterId", r.created_at AS "createdAt"`;

export async function linesOf(c, ids) {
  const { rows } = await c.query(
    `SELECT l.request_id, s.code AS sku, l.quantity FROM request_lines l JOIN skus s ON s.id = l.sku_id
      WHERE l.request_id = ANY($1::uuid[]) ORDER BY s.code`, [ids]);
  return rows;
}

// Carga una solicitud SOLO si es de la organización: otra org o inexistente => null (404).
export async function loadRequest(c, id, orgId, lock = false) {
  if (!isUuid(id)) return null;
  const { rows } = await c.query(
    `SELECT ${REQ_COLS} FROM requests r WHERE r.id = $1 AND r.org_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [id, orgId]);
  if (!rows[0]) return null;
  const lines = await linesOf(c, [id]);
  return { ...rows[0], lines: lines.map((l) => ({ sku: l.sku, quantity: l.quantity })) };
}

// Valida el cuerpo de crear/editar. Devuelve datos limpios o lanza 422 con los campos inválidos.
async function validateInput(c, b) {
  const fields = [];
  const bad = (field, message) => fields.push({ field, message });
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(422, 'VALIDATION', 'Cuerpo inválido', [{ field: 'body', message: 'debe ser un objeto JSON' }]);
  for (const k of Object.keys(b)) {
    if (!['zone', 'priority', 'requiredDate', 'notes', 'lines', 'code'].includes(k)) bad(k, 'propiedad no permitida'); // 'code' se ignora (Q-08)
  }
  if (!ZONES.includes(b.zone)) bad('zone', `debe ser una de: ${ZONES.join(', ')}`);
  if (!PRIORITIES.includes(b.priority)) bad('priority', 'debe ser NORMAL o ALTA');
  const d = b.requiredDate;
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) !== d) bad('requiredDate', 'debe ser una fecha YYYY-MM-DD válida');
  if (b.notes != null && (typeof b.notes !== 'string' || b.notes.length > 500)) bad('notes', 'texto de máximo 500 caracteres');

  const lines = Array.isArray(b.lines) ? b.lines : null;
  if (!lines || lines.length < 1 || lines.length > 10) bad('lines', 'debe tener de 1 a 10 líneas');
  const seen = new Set();
  (lines ?? []).forEach((l, i) => {
    if (!l || typeof l.sku !== 'string') return bad(`lines[${i}].sku`, 'obligatorio');
    if (seen.has(l.sku)) bad(`lines[${i}].sku`, 'SKU repetido');
    seen.add(l.sku);
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 500) bad(`lines[${i}].quantity`, 'debe ser un entero de 1 a 500');
  });

  let skuIds = {};
  if (!fields.length) {
    const { rows } = await c.query('SELECT id, code FROM skus WHERE code = ANY($1) AND active', [[...seen]]);
    skuIds = Object.fromEntries(rows.map((r) => [r.code, r.id]));
    lines.forEach((l, i) => { if (!skuIds[l.sku]) bad(`lines[${i}].sku`, 'SKU inexistente o inactivo'); });
  }
  if (fields.length) throw new HttpError(422, 'VALIDATION', 'Datos inválidos', fields);
  return { zone: b.zone, priority: b.priority, requiredDate: d, notes: b.notes ?? null, lines: lines.map((l) => ({ skuId: skuIds[l.sku], quantity: l.quantity })) };
}

const insertLines = (c, id, lines) =>
  Promise.all(lines.map((l) => c.query('INSERT INTO request_lines (request_id, sku_id, quantity) VALUES ($1,$2,$3)', [id, l.skuId, l.quantity])));

export const createRequest = wrap(async (req, res) => {
  const u = req.user;
  const out = await tx(async (c) => {
    const v = await validateInput(c, req.body);
    const { rows: [{ last_value }] } = await c.query(
      `INSERT INTO org_request_counters (org_id, last_value) VALUES ($1, 1)
       ON CONFLICT (org_id) DO UPDATE SET last_value = org_request_counters.last_value + 1 RETURNING last_value`, [u.orgId]);
    const code = `SOL-${u.orgCode}-${String(last_value).padStart(6, '0')}`;
    const { rows: [{ id }] } = await c.query(
      `INSERT INTO requests (code, org_id, requester_id, zone, priority, required_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [code, u.orgId, u.id, v.zone, v.priority, v.requiredDate, v.notes]);
    await insertLines(c, id, v.lines);
    await audit(c, { user: u, type: 'request', id, action: 'create', to: 'BORRADOR', cid: req.correlationId });
    return loadRequest(c, id, u.orgId);
  });
  res.status(201).json(out);
});

export const updateDraft = wrap(async (req, res) => {
  const u = req.user;
  const out = await tx(async (c) => {
    const cur = await loadRequest(c, req.params.id, u.orgId, true);
    if (!cur) throw new HttpError(404, 'NOT_FOUND', 'Solicitud no encontrada');
    if (cur.requesterId !== u.id) throw new HttpError(403, 'FORBIDDEN', 'La solicitud es de otro usuario');
    if (cur.status !== 'BORRADOR') throw new HttpError(409, 'INVALID_STATE', 'Solo un BORRADOR es editable');
    const v = await validateInput(c, req.body);
    await c.query('UPDATE requests SET zone=$2, priority=$3, required_date=$4, notes=$5, updated_at=now() WHERE id=$1',
      [cur.id, v.zone, v.priority, v.requiredDate, v.notes]);
    await c.query('DELETE FROM request_lines WHERE request_id = $1', [cur.id]);
    await insertLines(c, cur.id, v.lines);
    return loadRequest(c, cur.id, u.orgId);
  });
  res.json(out);
});

export const listRequests = wrap(async (req, res) => {
  const u = req.user;
  const { page, pageSize, offset } = paging(req.query);
  const where = ['r.org_id = $1'];
  const args = [u.orgId];
  const fields = [];
  if (u.role === 'SOLICITANTE') { args.push(u.id); where.push(`r.requester_id = $${args.length}`); }
  for (const [name, col, allowed] of [['status', 'status', STATUSES], ['priority', 'priority', PRIORITIES], ['zone', 'zone', ZONES]]) {
    const v = req.query[name];
    if (v === undefined) continue;
    if (!allowed.includes(v)) { fields.push({ field: name, message: `valor permitido: ${allowed.join(', ')}` }); continue; }
    args.push(v); where.push(`r.${col} = $${args.length}`);
  }
  if (fields.length) throw new HttpError(422, 'VALIDATION', 'Filtros inválidos', fields);

  const w = where.join(' AND ');
  const total = Number((await pool.query(`SELECT count(*) FROM requests r WHERE ${w}`, args)).rows[0].count);
  const { rows } = await pool.query(
    `SELECT ${REQ_COLS} FROM requests r WHERE ${w} ORDER BY r.created_at DESC, r.id LIMIT ${pageSize} OFFSET ${offset}`, args);
  const lines = rows.length ? await linesOf(pool, rows.map((r) => r.id)) : [];
  const items = rows.map((r) => ({ ...r, lines: lines.filter((l) => l.request_id === r.id).map((l) => ({ sku: l.sku, quantity: l.quantity })) }));
  res.json({ items, total, page, pageSize });
});

export const getRequest = wrap(async (req, res) => {
  const u = req.user;
  const r = await loadRequest(pool, req.params.id, u.orgId);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Solicitud no encontrada');
  if (u.role === 'SOLICITANTE' && r.requesterId !== u.id) throw new HttpError(403, 'FORBIDDEN', 'La solicitud es de otro usuario'); // Q-12
  const { rows } = await pool.query(
    `SELECT * FROM audit_events WHERE org_id = $1 AND resource_type = 'request' AND resource_id = $2 ORDER BY id`, [u.orgId, r.id]);
  res.json({ ...r, history: rows.map(auditRow) });
});
