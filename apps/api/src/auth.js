import crypto from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { pool } from './db.js';
import { HttpError, wrap } from './http.js';

const COOKIE = 'nexo_session';
const MAX_AGE_S = 8 * 3600;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const readCookie = (req) => (req.headers.cookie || '').match(/(?:^|;\s*)nexo_session=([a-f0-9]{64})/)?.[1];

const meOf = (u) => ({
  id: u.id,
  displayName: u.display_name,
  role: u.role,
  organization: { id: u.org_id, code: u.org_code, name: u.org_name },
});

// Identidad y organización salen de la sesión del servidor, nunca de lo que envía el navegador.
export const requireAuth = wrap(async (req, _res, next) => {
  const sid = readCookie(req);
  if (sid) {
    const { rows } = await pool.query(
      `SELECT u.id, u.org_id, u.role, u.display_name, o.code AS org_code, o.name AS org_name
         FROM sessions s JOIN users u ON u.id = s.user_id JOIN organizations o ON o.id = u.org_id
        WHERE s.id_hash = $1 AND s.expires_at > now() AND u.active`,
      [sha256(sid)],
    );
    if (rows[0]) {
      req.user = { id: rows[0].id, orgId: rows[0].org_id, role: rows[0].role, orgCode: rows[0].org_code, me: meOf(rows[0]) };
      return next();
    }
  }
  throw new HttpError(401, 'UNAUTHENTICATED', 'Inicie sesión');
});

export const login = wrap(async (req, res) => {
  const { email, password } = req.body ?? {};
  const fields = [];
  if (typeof email !== 'string' || !email || email.length > 254) fields.push({ field: 'email', message: 'obligatorio, máximo 254 caracteres' });
  if (typeof password !== 'string' || !password || password.length > 128) fields.push({ field: 'password', message: 'obligatoria, máximo 128 caracteres' });
  if (fields.length) throw new HttpError(422, 'VALIDATION', 'Datos de inicio de sesión inválidos', fields);

  const { rows } = await pool.query(
    `SELECT u.id, u.org_id, u.role, u.display_name, u.password_hash, o.code AS org_code, o.name AS org_name
       FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.email = lower($1) AND u.active`,
    [email],
  );
  const u = rows[0];
  const ok = u ? await verify(u.password_hash, password).catch(() => false) : false;
  if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');

  const sid = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [sha256(sid), u.id, MAX_AGE_S],
  );
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_S}${secure}`);
  res.json(meOf(u));
});

export const logout = wrap(async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE id_hash = $1', [sha256(readCookie(req))]);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.status(204).end();
});

export const me = (req, res) => res.json(req.user.me);
