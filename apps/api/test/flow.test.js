// Pruebas de integración contra PostgreSQL real.
// Requiere: DATABASE_URL (rol nexo_app) y OWNER_DATABASE_URL (rol propietario, solo para reiniciar el seed y leer el oráculo).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

const { app } = await import('../src/app.js');
const owner = new pg.Pool({ connectionString: process.env.OWNER_DATABASE_URL });
const seedSql = fs.readFileSync(new URL('../../../seeds/seed_small.sql', import.meta.url), 'utf8');
let base, server;

before(async () => { server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await owner.end(); (await import('../src/db.js')).pool.end(); });
const reseed = () => owner.query(seedSql);

async function login(email) {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Nexo-Demo-2026' }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
}
const who = (org, role) => login(`org-${org}-${role}@example.test`);
// Oráculo independiente: lee las cantidades directo de la base.
const stock = async (org, sku) => (await owner.query(
  `SELECT i.on_hand, i.reserved FROM inventory i JOIN organizations o ON o.id=i.org_id JOIN skus s ON s.id=i.sku_id WHERE o.code=$1 AND s.code=$2`, [org, sku])).rows[0];
const idOf = async (c, code) => (await c('GET', '/requests?pageSize=100')).body.items.find((r) => r.code === code).id;

test('sin sesión responde 401', async () => {
  assert.equal((await fetch(`${base}/requests`)).status, 401);
});

test('A-001 contra A-002 en paralelo: una reserva y un 409; 10/7/3; cancelar libera', async () => {
  await reseed();
  const coord = await who('a', 'coordinador');
  const [a1, a2] = [await idOf(coord, 'A-001'), await idOf(coord, 'A-002')];
  const rs = await Promise.all([
    coord('POST', `/requests/${a1}/reserve`, null, { 'Idempotency-Key': 'clave-0001' }),
    coord('POST', `/requests/${a2}/reserve`, null, { 'Idempotency-Key': 'clave-0002' }),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 10, reserved: 7 }); // disponible 3

  const winner = rs[0].status === 200 ? 'A-001' : 'A-002';
  const sol = await who('a', 'solicitante');
  const id = await idOf(sol, winner);
  assert.equal((await sol('POST', `/requests/${id}/cancel`)).status, 200);
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 10, reserved: 0 });
});

test('flujo completo, idempotencia y auditoría', async () => {
  await reseed();
  const sol = await who('a', 'solicitante'), coord = await who('a', 'coordinador');
  const bod = await who('a', 'bodega'), aud = await who('a', 'auditor');

  const created = await sol('POST', '/requests', { zone: 'NORTE', priority: 'NORMAL', requiredDate: '2030-01-20', lines: [{ sku: 'KIT-AGUA', quantity: 5 }] });
  assert.equal(created.status, 201);
  assert.match(created.body.code, /^SOL-ORG-A-\d{6}$/);
  const id = created.body.id;
  assert.equal((await sol('POST', `/requests/${id}/submit`)).body.status, 'ENVIADA');

  const key = { 'Idempotency-Key': 'clave-flujo-1' };
  const r1 = await coord('POST', `/requests/${id}/reserve`, null, key);
  const r2 = await coord('POST', `/requests/${id}/reserve`, null, key); // reintento: mismo resultado, sin duplicar
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  assert.deepEqual(r2.body, r1.body);
  assert.deepEqual(await stock('ORG-A', 'KIT-AGUA'), { on_hand: 20, reserved: 5 });
  const otro = await coord('POST', `/requests/${await idOf(coord, 'A-001')}/reserve`, null, key); // misma clave, otro contenido
  assert.equal(otro.status, 409);
  assert.equal((await coord('POST', `/requests/${id}/reserve`, null, { 'Idempotency-Key': 'clave-flujo-2' })).status, 409); // ya no está ENVIADA

  assert.equal((await bod('POST', `/requests/${id}/dispatch`)).status, 200);
  assert.deepEqual(await stock('ORG-A', 'KIT-AGUA'), { on_hand: 15, reserved: 0 });
  assert.equal((await coord('POST', `/requests/${id}/deliver`)).body.status, 'ENTREGADA');
  assert.deepEqual(await stock('ORG-A', 'KIT-AGUA'), { on_hand: 15, reserved: 0 }); // entregar no toca inventario

  const events = (await aud('GET', '/audit-events?pageSize=100')).body.items.filter((e) => e.resourceId === id);
  assert.deepEqual(events.map((e) => e.action).sort(), ['create', 'deliver', 'dispatch', 'reserve', 'submit']);
  assert.equal((await aud('GET', '/dashboard')).body.byStatus.ENTREGADA, 1);
});

test('aislamiento entre organizaciones y permisos por rol', async () => {
  await reseed();
  const coordA = await who('a', 'coordinador'), coordB = await who('b', 'coordinador');
  const audB = await who('b', 'auditor'), solA = await who('a', 'solicitante');
  const a1 = await idOf(coordA, 'A-001');
  assert.equal((await coordB('GET', `/requests/${a1}`)).status, 404);          // lectura cruzada 1
  assert.equal((await audB('GET', '/audit-events')).body.items.every((e) => e.resourceId !== a1), true); // lectura cruzada 2
  assert.equal((await coordB('POST', `/requests/${a1}/reserve`, null, { 'Idempotency-Key': 'clave-x-001' })).status, 404); // escritura cruzada 1
  assert.equal((await coordB('POST', '/ai/summaries', { requestIds: [a1] })).status, 404);                                 // escritura cruzada 2
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 10, reserved: 0 });
  assert.equal((await solA('POST', `/requests/${a1}/reserve`, null, { 'Idempotency-Key': 'clave-x-002' })).status, 403);   // rol
  assert.equal((await solA('GET', '/audit-events')).status, 403);
});

test('validación de entrada: 422 sin crear nada', async () => {
  await reseed();
  const sol = await who('a', 'solicitante');
  const mk = (lines) => sol('POST', '/requests', { zone: 'NORTE', priority: 'NORMAL', requiredDate: '2030-01-20', lines });
  for (const lines of [[{ sku: 'KIT-AGUA', quantity: 0 }], [{ sku: 'KIT-AGUA', quantity: 1.5 }], [{ sku: 'KIT-AGUA', quantity: 501 }],
    [{ sku: 'KIT-AGUA', quantity: 1 }, { sku: 'KIT-AGUA', quantity: 2 }], [{ sku: 'NO-EXISTE', quantity: 1 }], []]) {
    assert.equal((await mk(lines)).status, 422);
  }
  assert.equal((await sol('GET', '/requests')).body.total, 2); // solo A-001 y A-002 del seed
  assert.equal((await sol('GET', '/requests?pageSize=101')).status, 422);
});

test('asistente sin proveedor: resumen alternativo, aprobación única, solo coordinador', async () => {
  await reseed();
  const coord = await who('a', 'coordinador'), sol = await who('a', 'solicitante');
  const ids = [await idOf(coord, 'A-001'), await idOf(coord, 'A-002')];
  assert.equal((await sol('POST', '/ai/summaries', { requestIds: ids })).status, 403);
  const d = await coord('POST', '/ai/summaries', { requestIds: ids });
  assert.equal(d.status, 200);
  assert.equal(d.body.origin, 'fallback');
  assert.equal(d.body.recommendations[0].requestId, 'A-001'); // ALTA primero
  const ok = await coord('POST', `/ai/summaries/${d.body.id}/approve`);
  assert.ok(ok.body.approvedAt);
  assert.equal((await coord('POST', `/ai/summaries/${d.body.id}/approve`)).status, 409);
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 10, reserved: 0 }); // aprobar no mueve inventario
});
