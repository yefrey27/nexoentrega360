import crypto from 'node:crypto';
import { pool, tx } from './db.js';
import { audit } from './audit.js';
import { loadRequest } from './requests.js';
import { HttpError, errorBody, isUuid, wrap } from './http.js';

// Una fila por operación: quién puede, desde qué estado y hacia cuál.
const OPS = {
  submit:   { role: 'SOLICITANTE', owner: true, from: ['BORRADOR'], to: 'ENVIADA' },
  cancel:   { role: 'SOLICITANTE', owner: true, from: ['ENVIADA', 'RESERVADA'], to: 'CANCELADA' },
  reserve:  { role: 'COORDINADOR', from: ['ENVIADA'], to: 'RESERVADA' },
  dispatch: { role: 'BODEGA', from: ['RESERVADA'], to: 'DESPACHADA' },
  deliver:  { role: 'COORDINADOR', from: ['DESPACHADA'], to: 'ENTREGADA' },
};

const todayBogota = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Ajusta el inventario según la operación. Bloquea las filas en orden de sku para no producir interbloqueos.
async function applyInventory(c, op, from, request, orgId) {
  const { rows: lines } = await c.query(
    `SELECT l.sku_id, l.quantity, s.code FROM request_lines l JOIN skus s ON s.id = l.sku_id
      WHERE l.request_id = $1 ORDER BY l.sku_id`, [request.id]);

  if (op === 'reserve') {
    const short = [];
    for (const l of lines) {
      const { rows } = await c.query('SELECT on_hand, reserved FROM inventory WHERE org_id=$1 AND sku_id=$2 FOR UPDATE', [orgId, l.sku_id]);
      const available = rows[0] ? rows[0].on_hand - rows[0].reserved : 0; // sin fila = existencia 0 (Q-11)
      if (available < l.quantity) short.push({ field: l.code, message: `disponible ${available}, solicitado ${l.quantity}` });
    }
    if (short.length) return short; // todo o nada: no se modificó nada
    for (const l of lines) await c.query('UPDATE inventory SET reserved = reserved + $3, updated_at = now() WHERE org_id=$1 AND sku_id=$2', [orgId, l.sku_id, l.quantity]);
  } else if (op === 'cancel' && from === 'RESERVADA') {
    for (const l of lines) await c.query('UPDATE inventory SET reserved = reserved - $3, updated_at = now() WHERE org_id=$1 AND sku_id=$2', [orgId, l.sku_id, l.quantity]);
  } else if (op === 'dispatch') {
    for (const l of lines) await c.query('UPDATE inventory SET on_hand = on_hand - $3, reserved = reserved - $3, updated_at = now() WHERE org_id=$1 AND sku_id=$2', [orgId, l.sku_id, l.quantity]);
  }
  return null;
}

export const transition = (op) => wrap(async (req, res) => {
  const cfg = OPS[op];
  const u = req.user;
  const cid = req.correlationId;

  if (u.role !== cfg.role) throw new HttpError(403, 'FORBIDDEN', 'Su rol no permite esta operación');
  const pre = await loadRequest(pool, req.params.id, u.orgId);
  if (!pre) throw new HttpError(404, 'NOT_FOUND', 'Solicitud no encontrada');
  if (cfg.owner && pre.requesterId !== u.id) throw new HttpError(403, 'FORBIDDEN', 'La solicitud es de otro usuario');

  let key = null;
  if (op === 'reserve') {
    key = req.get('Idempotency-Key');
    if (!key || key.length < 8 || key.length > 128) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key obligatorio (8 a 128 caracteres)');
  }

  const out = await tx(async (c) => {
    // 1) Idempotencia (solo reserva), después de autenticar y autorizar.
    const idemArgs = [u.orgId, u.id, op, key];
    if (key) {
      const hash = sha256(`${op}|${req.params.id}|${JSON.stringify(req.body ?? {})}`);
      await c.query('DELETE FROM idempotency_keys WHERE org_id=$1 AND user_id=$2 AND operation=$3 AND key=$4 AND expires_at < now()', idemArgs);
      const ins = await c.query(
        `INSERT INTO idempotency_keys (org_id, user_id, operation, key, request_hash) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING RETURNING key`, [...idemArgs, hash]);
      if (!ins.rowCount) { // espera al commit de una petición concurrente con la misma clave
        const { rows: [ex] } = await c.query(
          'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE org_id=$1 AND user_id=$2 AND operation=$3 AND key=$4', idemArgs);
        if (ex.request_hash !== hash) return { status: 409, body: errorBody('IDEMPOTENCY_KEY_REUSED', 'La clave ya se usó con contenido distinto', cid) };
        return { status: ex.response_status, body: ex.response_body };
      }
    }
    const finish = async (status, body) => { // guarda 200 y 409 de negocio; los demás errores hacen ROLLBACK
      if (key) await c.query('UPDATE idempotency_keys SET response_status=$5, response_body=$6 WHERE org_id=$1 AND user_id=$2 AND operation=$3 AND key=$4', [...idemArgs, status, JSON.stringify(body)]);
      return { status, body };
    };

    // 2) Bloquea la solicitud y revisa el estado dentro de la transacción.
    const cur = await loadRequest(c, req.params.id, u.orgId, true);
    if (!cur) throw new HttpError(404, 'NOT_FOUND', 'Solicitud no encontrada');
    if (!cfg.from.includes(cur.status)) {
      const body = errorBody('INVALID_STATE', `No se puede ${op} una solicitud en estado ${cur.status}`, cid);
      if (!key) throw new HttpError(409, 'INVALID_STATE', body.error.message);
      return finish(409, body);
    }
    if (op === 'submit' && cur.requiredDate < todayBogota()) {
      throw new HttpError(422, 'VALIDATION', 'La fecha requerida es anterior a hoy (hora de Bogotá)', [{ field: 'requiredDate', message: 'no puede ser anterior a hoy' }]);
    }

    // 3) Inventario, estado y auditoría en la misma transacción.
    const short = await applyInventory(c, op, cur.status, cur, u.orgId);
    if (short) return finish(409, errorBody('INSUFFICIENT_STOCK', 'Disponibilidad insuficiente; no se reservó nada', cid, short));
    await c.query(`UPDATE requests SET status = $2::request_status, submitted_at = CASE WHEN $2::request_status = 'ENVIADA' THEN now() ELSE submitted_at END WHERE id = $1`, [cur.id, cfg.to]);
    await audit(c, { user: u, type: 'request', id: cur.id, action: op, from: cur.status, to: cfg.to, cid });
    return finish(200, await loadRequest(c, cur.id, u.orgId));
  });

  res.status(out.status).json(out.body);
});
