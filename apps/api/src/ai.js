import fs from 'node:fs';
import { pool, tx } from './db.js';
import { audit } from './audit.js';
import { HttpError, isUuid, wrap } from './http.js';

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 5000);
const EVIDENCE = ['zona', 'prioridad', 'fechaRequerida', 'observaciones'];
const PROVIDER = process.env.AI_PROVIDER || 'none';

// --- Proveedores intercambiables: reciben solo los campos autorizados y devuelven texto crudo ---
const providers = {
  none: async () => { throw new Error('IA no configurada'); },
  // Reproduce una salida de tests/fixtures/ai (id en AI_FIXTURE). Pasa por el mismo validador.
  fixture: async () => {
    const file = process.env.AI_FIXTURE_FILE || new URL('../../../tests/fixtures/ai/ai-provider-fixtures.json', import.meta.url);
    const f = JSON.parse(fs.readFileSync(file, 'utf8')).fixtures.find((x) => x.id === process.env.AI_FIXTURE);
    if (!f) throw new Error('fixture inexistente');
    if (f.transport === 'timeout') return new Promise(() => {}); // nunca responde: dispara el timeout
    if (f.transport === 'provider-error') throw new Error('fallo del proveedor');
    return f.rawOutput;
  },
};

// --- Validación estricta de la salida del modelo (el texto se trata como no confiable) ---
function validate(raw, sentCodes) {
  let o;
  try { o = JSON.parse(raw); } catch { return null; }
  const only = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).every((k) => keys.includes(k));
  if (!only(o, ['summary', 'recommendations']) || typeof o.summary !== 'string' || o.summary.length > 600) return null;
  if (!Array.isArray(o.recommendations) || o.recommendations.length > 5) return null;
  const seen = new Set();
  for (const r of o.recommendations) {
    if (!only(r, ['requestId', 'reason', 'evidenceFields'])) return null;
    if (!sentCodes.has(r.requestId) || seen.has(r.requestId)) return null; // ID ajeno o repetido
    seen.add(r.requestId);
    if (typeof r.reason !== 'string' || r.reason.length > 240) return null;
    const ev = r.evidenceFields;
    if (!Array.isArray(ev) || ev.length < 1 || ev.length > 3 || new Set(ev).size !== ev.length || !ev.every((e) => EVIDENCE.includes(e))) return null;
  }
  return { summary: o.summary, recommendations: o.recommendations };
}

// --- Resumen determinista alternativo (Q-13) ---
function fallback(rows) {
  const count = (k) => Object.entries(rows.reduce((a, r) => ({ ...a, [r[k]]: (a[r[k]] || 0) + 1 }), {})).map(([n, v]) => `${n}: ${v}`).join(', ');
  const top = [...rows].sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'ALTA' ? -1 : 1) || a.date.localeCompare(b.date) || a.code.localeCompare(b.code)).slice(0, 5);
  return {
    summary: `Resumen automático sin IA: ${rows.length} solicitudes. Prioridad → ${count('priority')}. Zona → ${count('zone')}.`.slice(0, 600),
    recommendations: top.map((r) => ({ requestId: r.code, reason: `Prioridad ${r.priority}, fecha requerida ${r.date}.`, evidenceFields: ['prioridad', 'fechaRequerida'] })),
  };
}

const draftOf = (row) => ({
  id: row.id,
  origin: row.origin,
  label: row.origin === 'ai' ? 'Borrador con asistencia de IA' : 'Resumen automático sin IA',
  ...(row.origin === 'fallback' ? { message: 'La IA no está disponible o su salida no fue válida; se muestra un resumen automático.' } : {}),
  summary: row.summary,
  recommendations: row.recommendations,
  requestIds: row.request_ids,
  approvedAt: row.approved_at,
  provider: row.provider,
});

export const createSummary = wrap(async (req, res) => {
  const u = req.user;
  const ids = req.body?.requestIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length || !ids.every(isUuid)) {
    throw new HttpError(422, 'VALIDATION', 'requestIds: de 1 a 20 UUID distintos', [{ field: 'requestIds', message: 'de 1 a 20 UUID distintos' }]);
  }
  const { rows } = await pool.query(
    `SELECT id, code, zone, priority, to_char(required_date,'YYYY-MM-DD') AS date, notes, status
       FROM requests WHERE id = ANY($1::uuid[]) AND org_id = $2`, [ids, u.orgId]);
  if (rows.length !== ids.length) throw new HttpError(404, 'NOT_FOUND', 'Alguna solicitud no existe'); // incluye las de otra organización
  if (rows.some((r) => r.status !== 'ENVIADA')) throw new HttpError(422, 'VALIDATION', 'Solo se resumen solicitudes ENVIADA', [{ field: 'requestIds', message: 'todas deben estar ENVIADA' }]);

  // El proveedor recibe SOLO estos campos autorizados.
  const input = rows.map((r) => ({ requestId: r.code, zona: r.zone, prioridad: r.priority, fechaRequerida: r.date, estado: r.status, observaciones: r.notes }));
  const t0 = Date.now();
  let outcome = 'ok';
  let result = null;
  let timer;
  try {
    const raw = await Promise.race([
      (providers[PROVIDER] || providers.none)(input),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS); }),
    ]);
    result = validate(raw, new Set(rows.map((r) => r.code)));
    if (!result) outcome = 'invalid_output';
  } catch (e) {
    outcome = e.message === 'timeout' ? 'timeout' : 'provider_error';
  } finally { clearTimeout(timer); }

  const origin = result ? 'ai' : 'fallback';
  const final = result || fallback(rows);
  const { rows: [row] } = await pool.query(
    `INSERT INTO ai_attempts (org_id, user_id, provider, outcome, origin, duration_ms, request_ids, summary, recommendations, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9,$10) RETURNING *`,
    [u.orgId, u.id, PROVIDER in providers ? PROVIDER : 'none', outcome, origin, Date.now() - t0, ids, final.summary, JSON.stringify(final.recommendations), req.correlationId]);
  res.json(draftOf(row)); // nunca reserva, despacha ni cambia prioridad
});

export const approveSummary = wrap(async (req, res) => {
  const u = req.user;
  const row = await tx(async (c) => {
    const found = isUuid(req.params.summaryId)
      ? (await c.query('SELECT * FROM ai_attempts WHERE id = $1 AND org_id = $2 FOR UPDATE', [req.params.summaryId, u.orgId])).rows[0]
      : null;
    if (!found) throw new HttpError(404, 'NOT_FOUND', 'Resumen no encontrado');
    if (found.approved_by) throw new HttpError(409, 'ALREADY_APPROVED', 'El resumen ya fue aprobado');
    const { rows: reqs } = await c.query('SELECT code, status FROM requests WHERE id = ANY($1::uuid[]) AND org_id = $2', [found.request_ids, u.orgId]);
    const { rows: [upd] } = await c.query('UPDATE ai_attempts SET approved_by = $2, approved_at = now() WHERE id = $1 RETURNING *', [found.id, u.id]);
    await audit(c, { user: u, type: 'ai_summary', id: found.id, action: 'approve_summary', cid: req.correlationId, details: { origin: found.origin, requests: reqs } });
    return upd;
  });
  res.json(draftOf(row));
});
