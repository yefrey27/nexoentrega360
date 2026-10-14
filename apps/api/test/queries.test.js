// T-14 Consultas y tablero (RF08). Oráculo: valores calculados a mano a partir del seed pequeño.
// Seed ORG-A: A-001 (NORTE, ALTA, 7 ALIMENTO) y A-002 (SUR, NORMAL, 7 ALIMENTO), ambas ENVIADA.
// Stock ORG-A: ALIMENTO 10, HIGIENE 8, AGUA 20. ORG-B: B-001 (CENTRO, ALTA, 2 HIGIENE), stock 4/5/6.
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
const idOf = async (code) => (await owner.query('SELECT id FROM requests WHERE code=$1', [code])).rows[0].id;

let n = 0;
const key = () => `q-${process.pid}-${++n}`;
const op = (c, id, name) => c('POST', `/requests/${id}/${name}`, undefined, { 'Idempotency-Key': key() });
const codes = (r) => r.body.items.map((i) => i.code).sort();

const ORIGINAL = { zone: 'NORTE', priority: 'NORMAL', requiredDate: '2030-01-15', lines: [{ sku: 'KIT-ALIMENTO', quantity: 1 }] };

async function extraSolicitanteA() {
  const email = 'org-a-solicitante2@example.test';
  await owner.query(
    `INSERT INTO users (org_id, email, display_name, role, password_hash)
     SELECT u.org_id, $1, 'SOLICITANTE 2 ORG-A', 'SOLICITANTE'::user_role, u.password_hash FROM users u WHERE u.email = 'org-a-solicitante@example.test'`, [email]);
  return login(email);
}

// ---------- Paginación ----------
test('pageSize=100 es válido y se devuelve en la respuesta', async () => {
  await reseed();
  const coord = await who('a', 'coordinador');
  const r = await coord('GET', '/requests?pageSize=100');
  assert.equal(r.status, 200);
  assert.equal(r.body.pageSize, 100);
  assert.equal(r.body.page, 1);
  assert.equal(r.body.total, 2);
  assert.deepEqual(codes(r), ['A-001', 'A-002']);
});

test('valores por defecto: page 1 y pageSize 20', async () => {
  await reseed();
  const r = await (await who('a', 'coordinador'))('GET', '/requests');
  assert.equal(r.status, 200);
  assert.equal(r.body.page, 1);
  assert.equal(r.body.pageSize, 20);
});

for (const q of ['pageSize=101', 'pageSize=0', 'pageSize=-1', 'pageSize=abc', 'pageSize=1.5', 'page=0', 'page=x']) {
  test(`paginación inválida (${q}) responde 422`, async () => {
    await reseed();
    const r = await (await who('a', 'coordinador'))('GET', `/requests?${q}`);
    assert.equal(r.status, 422);
    assert.ok(r.body.error.fields.length >= 1);
  });
}

test('páginas de tamaño 1: sin solapamiento y la página 3 queda vacía', async () => {
  await reseed();
  const coord = await who('a', 'coordinador');
  const p1 = await coord('GET', '/requests?pageSize=1&page=1');
  const p2 = await coord('GET', '/requests?pageSize=1&page=2');
  const p3 = await coord('GET', '/requests?pageSize=1&page=3');
  assert.equal(p1.body.items.length, 1);
  assert.equal(p2.body.items.length, 1);
  assert.equal(p1.body.total, 2);
  assert.deepEqual([...codes(p1), ...codes(p2)].sort(), ['A-001', 'A-002']);
  assert.equal(p3.status, 200);
  assert.deepEqual(p3.body.items, []);
  assert.equal(p3.body.total, 2);
});

test('auditoría: pageSize=101 responde 422 y pageSize=100 responde 200', async () => {
  await reseed();
  const auditor = await who('a', 'auditor');
  assert.equal((await auditor('GET', '/audit-events?pageSize=101')).status, 422);
  assert.equal((await auditor('GET', '/audit-events?pageSize=100')).status, 200);
});

// ---------- Filtros ----------
test('filtros por estado, prioridad y zona sobre el seed', async () => {
  await reseed();
  const coord = await who('a', 'coordinador');
  const q = async (qs) => codes(await coord('GET', `/requests?${qs}`));
  assert.deepEqual(await q('status=ENVIADA'), ['A-001', 'A-002']);
  assert.deepEqual(await q('status=RESERVADA'), []);
  assert.deepEqual(await q('priority=ALTA'), ['A-001']);
  assert.deepEqual(await q('priority=NORMAL'), ['A-002']);
  assert.deepEqual(await q('zone=NORTE'), ['A-001']);
  assert.deepEqual(await q('zone=SUR'), ['A-002']);
  assert.deepEqual(await q('zone=CENTRO'), []); // CENTRO solo existe en ORG-B
  assert.deepEqual(await q('status=ENVIADA&priority=ALTA&zone=NORTE'), ['A-001']);
  assert.deepEqual(await q('priority=ALTA&zone=SUR'), []);
});

test('el filtro por estado sigue a las transiciones y total coincide con el filtro', async () => {
  await reseed();
  const coord = await who('a', 'coordinador');
  assert.equal((await op(coord, await idOf('A-001'), 'reserve')).status, 200);
  const res = await coord('GET', '/requests?status=RESERVADA');
  assert.deepEqual(codes(res), ['A-001']);
  assert.equal(res.body.total, 1);
  assert.deepEqual(codes(await coord('GET', '/requests?status=ENVIADA')), ['A-002']);
});

for (const [q, field] of [['status=XX', 'status'], ['priority=URGENTE', 'priority'], ['zone=OESTE', 'zone']]) {
  test(`filtro inválido (${q}) responde 422 indicando ${field}`, async () => {
    await reseed();
    const r = await (await who('a', 'coordinador'))('GET', `/requests?${q}`);
    assert.equal(r.status, 422);
    assert.ok(r.body.error.fields.some((f) => f.field === field));
  });
}

// ---------- Alcance por rol y organización ----------
test('cada organización ve solo sus solicitudes', async () => {
  await reseed();
  const a = await (await who('a', 'coordinador'))('GET', '/requests?pageSize=100');
  const b = await (await who('b', 'coordinador'))('GET', '/requests?pageSize=100');
  assert.deepEqual(codes(a), ['A-001', 'A-002']);
  assert.deepEqual(codes(b), ['B-001']);
  assert.equal(b.body.total, 1);
});

test('el solicitante ve solo sus solicitudes aunque haya otras en su organización', async () => {
  await reseed();
  const sol = await who('a', 'solicitante');
  const otro = await extraSolicitanteA();
  const mia = await otro('POST', '/requests', ORIGINAL);
  assert.equal(mia.status, 201);

  const delPrimero = await sol('GET', '/requests?pageSize=100');
  assert.deepEqual(codes(delPrimero), ['A-001', 'A-002']);
  assert.equal(delPrimero.body.total, 2);

  const delOtro = await otro('GET', '/requests?pageSize=100');
  assert.deepEqual(delOtro.body.items.map((i) => i.code), [mia.body.code]);
  assert.equal(delOtro.body.total, 1);

  // el coordinador sí ve las tres de la organización
  assert.equal((await (await who('a', 'coordinador'))('GET', '/requests?pageSize=100')).body.total, 3);
});

// ---------- Tablero ----------
const inv = (d, sku) => {
  const i = d.body.inventory.find((x) => x.sku === sku);
  return { onHand: Number(i.onHand), reserved: Number(i.reserved), available: Number(i.available) };
};
const by = (d) => d.body.byStatus;

test('tablero inicial de ORG-A con cantidades calculadas a mano', async () => {
  await reseed();
  const d = await (await who('a', 'coordinador'))('GET', '/dashboard');
  assert.equal(d.status, 200);
  assert.deepEqual(by(d), { BORRADOR: 0, ENVIADA: 2, RESERVADA: 0, DESPACHADA: 0, ENTREGADA: 0, CANCELADA: 0 });
  assert.deepEqual(inv(d, 'KIT-ALIMENTO'), { onHand: 10, reserved: 0, available: 10 });
  assert.deepEqual(inv(d, 'KIT-HIGIENE'), { onHand: 8, reserved: 0, available: 8 });
  assert.deepEqual(inv(d, 'KIT-AGUA'), { onHand: 20, reserved: 0, available: 20 });
});

test('tablero inicial de ORG-B', async () => {
  await reseed();
  const d = await (await who('b', 'bodega'))('GET', '/dashboard');
  assert.deepEqual(by(d), { BORRADOR: 0, ENVIADA: 1, RESERVADA: 0, DESPACHADA: 0, ENTREGADA: 0, CANCELADA: 0 });
  assert.deepEqual(inv(d, 'KIT-ALIMENTO'), { onHand: 4, reserved: 0, available: 4 });
  assert.deepEqual(inv(d, 'KIT-HIGIENE'), { onHand: 5, reserved: 0, available: 5 });
  assert.deepEqual(inv(d, 'KIT-AGUA'), { onHand: 6, reserved: 0, available: 6 });
});

test('el tablero sigue cada paso: reserva, reserva rechazada, despacho, entrega y cancelación', async () => {
  await reseed();
  const coord = await who('a', 'coordinador'), bodega = await who('a', 'bodega'), sol = await who('a', 'solicitante');
  const [a1, a2] = [await idOf('A-001'), await idOf('A-002')];
  const dash = () => coord('GET', '/dashboard');

  assert.equal((await op(coord, a1, 'reserve')).status, 200);
  let d = await dash();
  assert.deepEqual(by(d), { BORRADOR: 0, ENVIADA: 1, RESERVADA: 1, DESPACHADA: 0, ENTREGADA: 0, CANCELADA: 0 });
  assert.deepEqual(inv(d, 'KIT-ALIMENTO'), { onHand: 10, reserved: 7, available: 3 });

  assert.equal((await op(coord, a2, 'reserve')).status, 409); // 7 > 3: no reserva nada
  d = await dash();
  assert.deepEqual(by(d), { BORRADOR: 0, ENVIADA: 1, RESERVADA: 1, DESPACHADA: 0, ENTREGADA: 0, CANCELADA: 0 });
  assert.deepEqual(inv(d, 'KIT-ALIMENTO'), { onHand: 10, reserved: 7, available: 3 });

  assert.equal((await op(bodega, a1, 'dispatch')).status, 200);
  d = await dash();
  assert.deepEqual(by(d), { BORRADOR: 0, ENVIADA: 1, RESERVADA: 0, DESPACHADA: 1, ENTREGADA: 0, CANCELADA: 0 });
  assert.deepEqual(inv(d, 'KIT-ALIMENTO'), { onHand: 3, reserved: 0, available: 3 });

  assert.equal((await op(coord, a1, 'deliver')).status, 200);
  d = await dash();
  assert.deepEqual(by(d), { BORRADOR: 0, ENVIADA: 1, RESERVADA: 0, DESPACHADA: 0, ENTREGADA: 1, CANCELADA: 0 });
  assert.deepEqual(inv(d, 'KIT-ALIMENTO'), { onHand: 3, reserved: 0, available: 3 });

  assert.equal((await op(sol, a2, 'cancel')).status, 200);
  d = await dash();
  assert.deepEqual(by(d), { BORRADOR: 0, ENVIADA: 0, RESERVADA: 0, DESPACHADA: 0, ENTREGADA: 1, CANCELADA: 1 });
  assert.deepEqual(inv(d, 'KIT-ALIMENTO'), { onHand: 3, reserved: 0, available: 3 });
  // los otros SKU no se movieron
  assert.deepEqual(inv(d, 'KIT-HIGIENE'), { onHand: 8, reserved: 0, available: 8 });
});

test('el tablero cuenta los borradores', async () => {
  await reseed();
  const sol = await who('a', 'solicitante');
  assert.equal((await sol('POST', '/requests', ORIGINAL)).status, 201);
  const d = await (await who('a', 'auditor'))('GET', '/dashboard');
  assert.deepEqual(by(d), { BORRADOR: 1, ENVIADA: 2, RESERVADA: 0, DESPACHADA: 0, ENTREGADA: 0, CANCELADA: 0 });
});
