import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pool } from './db.js';
import { HttpError, allow, errorBody, logEvent, wrap } from './http.js';
import { requireAuth, login, logout, me } from './auth.js';
import { createRequest, updateDraft, listRequests, getRequest } from './requests.js';
import { transition } from './transitions.js';
import { dashboard, listAudit } from './queries.js';
import { createSummary, approveSummary } from './ai.js';

export const app = express();
app.disable('x-powered-by');

// correlationId por petición + log estructurado (sin cuerpos, cookies ni contraseñas)
app.use((req, res, next) => {
  const given = req.get('x-correlation-id');
  req.correlationId = given && /^[\w-]{8,64}$/.test(given) ? given : crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  const t0 = Date.now();
  res.on('finish', () => logEvent({ level: 'info', correlationId: req.correlationId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t0, userId: req.user?.id }));
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../web')));

// health: el proceso vive. ready: hay base y migraciones aplicadas.
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/ready', wrap(async (_req, res) => {
  try {
    await pool.query("SELECT 1 FROM schema_migrations WHERE version = '0001_init'");
    res.json({ status: 'ok' });
  } catch { res.status(503).json({ status: 'unavailable' }); }
}));

app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.post('/auth/login', login);
app.use(requireAuth);
app.post('/auth/logout', logout);
app.get('/me', me);

const ALL = ['SOLICITANTE', 'COORDINADOR', 'BODEGA', 'AUDITOR'];
app.get('/requests', allow(...ALL), listRequests);
app.post('/requests', allow('SOLICITANTE'), createRequest);
app.get('/requests/:id', allow(...ALL), getRequest);
app.put('/requests/:id', allow('SOLICITANTE'), updateDraft);
for (const op of ['submit', 'cancel', 'reserve', 'dispatch', 'deliver']) app.post(`/requests/:id/${op}`, transition(op));
app.get('/dashboard', allow('COORDINADOR', 'BODEGA', 'AUDITOR'), dashboard);
app.get('/audit-events', allow('AUDITOR'), listAudit);
app.post('/ai/summaries', allow('COORDINADOR'), createSummary);
app.post('/ai/summaries/:summaryId/approve', allow('COORDINADOR'), approveSummary);

app.use((req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Ruta no encontrada')));

// Un solo manejador de errores: formato estándar y sin detalles internos en 5xx.
app.use((err, req, res, _next) => {
  let { status, code, message, fields } = err;
  if (err.type === 'entity.parse.failed') { status = 422; code = 'VALIDATION'; message = 'JSON inválido'; }
  else if (err.type === 'entity.too.large') { status = 422; code = 'VALIDATION'; message = 'Cuerpo demasiado grande'; }
  else if (err.code === '23514') { status = 409; code = 'INVALID_STATE'; message = 'La operación viola una regla de negocio'; } // defensa en profundidad de la base
  else if (!status) {
    logEvent({ level: 'error', correlationId: req.correlationId, error: err.message });
    status = 500; code = 'INTERNAL'; message = 'Error interno';
  }
  res.status(status).json(errorBody(code, message, req.correlationId, fields));
});
