// T-23 Seguridad: escrituras y lecturas cruzadas, roles y solicitante ajeno (RF02, RNF01).
// Oráculo: lectura directa de la base con el rol propietario. Estados esperados escritos a mano.
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
const stock = async (org, sku) => (await owner.query(
  `SELECT i.on_hand, i.reserved FROM inventory i JOIN organizations o ON o.id=i.org_id JOIN skus s ON s.id=i.sku_id WHERE o.code=$1 AND s.code=$2`, [org, sku])).rows[0];
const row = async (id) => (await owner.query('SELECT zone, priority, notes, status FROM requests WHERE id=$1', [id])).rows[0];
const idOf = async (code) => (await owner.query('SELECT id FROM requests WHERE code=$1', [code])).rows[0].id;
const statusOf = async (id) => (await row(id)).status;

let n = 0;
const key = () => `sec-${process.pid}-${++n}`;
const op = (c, id, name) => c('POST', `/requests/${id}/${name}`, undefined, { 'Idempotency-Key': key() });

const ORIGINAL = { zone: 'NORTE', priority: 'NORMAL', requiredDate: '2030-01-15', lines: [{ sku: 'KIT-ALIMENTO', quantity: 1 }] };

async function extraSolicitanteA() {
  const email = 'org-a-solicitante2@example.test';
  await owner.query(
    `INSERT INTO users (org_id, email, display_name, role, password_hash)
     SELECT u.org_id, $1, 'SOLICITANTE 2 ORG-A', 'SOLICITANTE'::user_role, u.password_hash FROM users u WHERE u.email = 'org-a-solicitante@example.test'`, [email]);
  return login(email);
}

test('escrituras cruzadas: cancel, dispatch y deliver de ORG-B sobre A-001 dan 404 y no cambian nada', async () => {
  await reseed();
  const a1 = await idOf('A-001');
  const coordA = await who('a', 'coordinador'), bodegaA = await who('a', 'bodega');
  const solB = await who('b', 'solicitante'), bodegaB = await who('b', 'bodega'), coordB = await who('b', 'coordinador');

  // ENVIADA: cancel cruzado
  const c1 = await op(solB, a1, 'cancel');
  assert.equal(c1.status, 404);
  assert.equal(c1.body.error.code, 'NOT_FOUND');
  assert.equal(await statusOf(a1), 'ENVIADA');
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 10, reserved: 0 });

  // RESERVADA: cancel y dispatch cruzados
  assert.equal((await op(coordA, a1, 'reserve')).status, 200);
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 10, reserved: 7 });
  assert.equal((await op(solB, a1, 'cancel')).status, 404);
  assert.equal((await op(bodegaB, a1, 'dispatch')).status, 404);
  assert.equal(await statusOf(a1), 'RESERVADA');
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 10, reserved: 7 });

  // DESPACHADA: deliver cruzado
  assert.equal((await op(bodegaA, a1, 'dispatch')).status, 200);
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 3, reserved: 0 });
  assert.equal((await op(coordB, a1, 'deliver')).status, 404);
  assert.equal(await statusOf(a1), 'DESPACHADA');
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 3, reserved: 0 });
});

test('lectura cruzada del tablero: ORG-B solo ve sus cifras aunque ORG-A reserve', async () => {
  await reseed();
  const a1 = await idOf('A-001');
  const coordA = await who('a', 'coordinador'), coordB = await who('b', 'coordinador');
  assert.equal((await op(coordA, a1, 'reserve')).status, 200);

  const d = await coordB('GET', '/dashboard');
  assert.equal(d.status, 200);
  assert.equal(d.body.byStatus.ENVIADA, 1); // solo B-001
  assert.equal(d.body.byStatus.RESERVADA, 0);
  const alim = d.body.inventory.find((i) => i.sku === 'KIT-ALIMENTO');
  assert.deepEqual({ onHand: Number(alim.onHand), reserved: Number(alim.reserved), available: Number(alim.available) }, { onHand: 4, reserved: 0, available: 4 });
  assert.deepEqual(await stock('ORG-B', 'KIT-ALIMENTO'), { on_hand: 4, reserved: 0 });
});

test('lectura cruzada de auditoría: el auditor de ORG-B ve exactamente los eventos de su organización', async () => {
  await reseed();
  const a1 = await idOf('A-001');
  const coordA = await who('a', 'coordinador'), auditorB = await who('b', 'auditor');
  assert.equal((await op(coordA, a1, 'reserve')).status, 200);
  const expected = (await owner.query(
    `SELECT count(*)::int AS n FROM audit_events e JOIN organizations o ON o.id = e.org_id WHERE o.code = 'ORG-B'`)).rows[0].n;
  const r = await auditorB('GET', '/audit-events?pageSize=100');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, expected);
  assert.ok(!JSON.stringify(r.body).includes(a1), 'el id de A-001 no debe aparecer en la auditoría de ORG-B');
});

test('otro solicitante de ORG-A: PUT, GET y cancel sobre el borrador ajeno dan 403 y no cambian nada', async () => {
  await reseed();
  const sol = await who('a', 'solicitante');
  const otro = await extraSolicitanteA();
  const d = await sol('POST', '/requests', ORIGINAL);
  assert.equal(d.status, 201);

  assert.equal((await otro('PUT', `/requests/${d.body.id}`, { ...ORIGINAL, zone: 'SUR' })).status, 403);
  assert.equal((await otro('GET', `/requests/${d.body.id}`)).status, 403);
  assert.deepEqual(await row(d.body.id), { zone: 'NORTE', priority: 'NORMAL', notes: null, status: 'BORRADOR' });

  // submit y cancel sobre solicitud enviada ajena (A-002 es de org-a-solicitante)
  const a2 = await idOf('A-002');
  assert.equal((await op(otro, a2, 'cancel')).status, 403);
  assert.equal(await statusOf(a2), 'ENVIADA');
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 10, reserved: 0 });
});

test('roles equivocados sobre recurso propio: 403 sin cambios', async () => {
  await reseed();
  const a1 = await idOf('A-001');
  const solA = await who('a', 'solicitante'), coordA = await who('a', 'coordinador');
  const bodegaA = await who('a', 'bodega'), auditorA = await who('a', 'auditor');

  assert.equal((await op(solA, a1, 'reserve')).status, 403);
  assert.equal((await op(bodegaA, a1, 'reserve')).status, 403);
  assert.equal((await op(auditorA, a1, 'reserve')).status, 403);
  assert.equal(await statusOf(a1), 'ENVIADA');

  assert.equal((await op(coordA, a1, 'reserve')).status, 200);
  assert.equal((await op(coordA, a1, 'dispatch')).status, 403);
  assert.equal((await op(solA, a1, 'dispatch')).status, 403);
  assert.equal(await statusOf(a1), 'RESERVADA');
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 10, reserved: 7 });

  assert.equal((await op(bodegaA, a1, 'dispatch')).status, 200);
  assert.equal((await op(bodegaA, a1, 'deliver')).status, 403);
  assert.equal((await op(auditorA, a1, 'deliver')).status, 403);
  assert.equal(await statusOf(a1), 'DESPACHADA');
});

test('tablero: el solicitante recibe 403; bodega y auditor reciben 200', async () => {
  await reseed();
  assert.equal((await (await who('a', 'solicitante'))('GET', '/dashboard')).status, 403);
  assert.equal((await (await who('a', 'bodega'))('GET', '/dashboard')).status, 200);
  assert.equal((await (await who('a', 'auditor'))('GET', '/dashboard')).status, 200);
});
