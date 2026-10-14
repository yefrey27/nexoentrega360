// Dominio: validación de entrada (RF03) y transiciones (RF04-RF06). Oráculo: base real, valores a mano.
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
const counts = async () => (await owner.query(
  'SELECT (SELECT count(*)::int FROM requests) AS requests, (SELECT count(*)::int FROM request_lines) AS lines')).rows[0];

let n = 0;
const key = () => `dom-${process.pid}-${++n}`;
const ROLE_OF = { submit: 'solicitante', reserve: 'coordinador', dispatch: 'bodega', deliver: 'coordinador', cancel: 'solicitante' };
async function actors() {
  const A = {};
  for (const r of new Set(Object.values(ROLE_OF))) A[r] = await who('a', r);
  return A;
}
const call = (A, id, name) => A[ROLE_OF[name]]('POST', `/requests/${id}/${name}`, undefined, { 'Idempotency-Key': key() });

const VALID = { zone: 'NORTE', priority: 'NORMAL', requiredDate: '2030-01-15', notes: 'ok', lines: [{ sku: 'KIT-ALIMENTO', quantity: 1 }] };
const withLines = (lines) => ({ ...VALID, lines });
const sku = 'KIT-ALIMENTO';

// ---------- Validación: un caso por prueba, 422 y nada creado ----------
const INVALID = [
  ['cantidad 0', withLines([{ sku, quantity: 0 }]), 'lines[0].quantity'],
  ['cantidad negativa', withLines([{ sku, quantity: -3 }]), 'lines[0].quantity'],
  ['cantidad decimal', withLines([{ sku, quantity: 1.5 }]), 'lines[0].quantity'],
  ['cantidad 501', withLines([{ sku, quantity: 501 }]), 'lines[0].quantity'],
  ['cantidad como texto', withLines([{ sku, quantity: '5' }]), 'lines[0].quantity'],
  ['SKU repetido', withLines([{ sku, quantity: 1 }, { sku, quantity: 2 }]), 'lines[1].sku'],
  ['SKU inexistente', withLines([{ sku: 'KIT-NOEXISTE', quantity: 1 }]), 'lines[0].sku'],
  ['sin líneas', withLines([]), 'lines'],
  ['11 líneas', withLines(Array.from({ length: 11 }, (_, i) => ({ sku: `X-${i}`, quantity: 1 }))), 'lines'],
  ['zona desconocida', { ...VALID, zone: 'OESTE' }, 'zone'],
  ['prioridad inválida', { ...VALID, priority: 'URGENTE' }, 'priority'],
  ['fecha con formato incorrecto', { ...VALID, requiredDate: '15/01/2030' }, 'requiredDate'],
  ['fecha inexistente', { ...VALID, requiredDate: '2030-02-30' }, 'requiredDate'],
  ['observaciones de 501 caracteres', { ...VALID, notes: 'x'.repeat(501) }, 'notes'],
  ['propiedad no permitida', { ...VALID, status: 'ENTREGADA' }, 'status'],
];
for (const [name, body, field] of INVALID) {
  test(`validación: ${name} responde 422 y no crea nada`, async () => {
    await reseed();
    const sol = await who('a', 'solicitante');
    const before = await counts();
    const r = await sol('POST', '/requests', body);
    assert.equal(r.status, 422);
    assert.ok(r.body.error.fields.some((f) => f.field === field), `se esperaba el campo ${field}: ${JSON.stringify(r.body.error.fields)}`);
    assert.deepEqual(await counts(), before);
    assert.deepEqual(await stock('ORG-A', sku), { on_hand: 10, reserved: 0 });
  });
}

test('validación: los límites válidos se aceptan (cantidad 1 y 500, 10 líneas con SKU distintos no aplica con 3 SKU)', async () => {
  await reseed();
  const sol = await who('a', 'solicitante');
  assert.equal((await sol('POST', '/requests', withLines([{ sku, quantity: 1 }]))).status, 201);
  const r = await sol('POST', '/requests', withLines([{ sku, quantity: 500 }]));
  assert.equal(r.status, 201);
  assert.equal((await counts()).requests, 5); // 3 del seed + 2
  assert.deepEqual(await stock('ORG-A', sku), { on_hand: 10, reserved: 0 }); // crear no toca inventario
});

test('validación: fecha requerida anterior al envío se rechaza al enviar con 422 y sigue en BORRADOR', async () => {
  await reseed();
  const sol = await who('a', 'solicitante');
  const d = await sol('POST', '/requests', { ...VALID, requiredDate: '2020-01-01' });
  if (d.status === 422) return; // también es válido rechazarla al crear
  assert.equal(d.status, 201);
  const r = await sol('POST', `/requests/${d.body.id}/submit`, undefined, { 'Idempotency-Key': key() });
  assert.equal(r.status, 422);
  assert.equal(await statusOf(d.body.id), 'BORRADOR');
});

// ---------- Transiciones permitidas: camino completo con inventario ----------
test('camino permitido: reserva, despacho y entrega mueven el inventario como indica RF06', async () => {
  await reseed();
  const A = await actors();
  const a1 = await idOf('A-001');
  assert.equal((await call(A, a1, 'reserve')).status, 200);
  assert.deepEqual(await stock('ORG-A', sku), { on_hand: 10, reserved: 7 });
  assert.equal((await call(A, a1, 'dispatch')).status, 200);
  assert.deepEqual(await stock('ORG-A', sku), { on_hand: 3, reserved: 0 });
  assert.equal((await call(A, a1, 'deliver')).status, 200);
  assert.deepEqual(await stock('ORG-A', sku), { on_hand: 3, reserved: 0 });
  assert.equal(await statusOf(a1), 'ENTREGADA');
});

test('cancelar una RESERVADA libera exactamente su reserva; cancelar una ENVIADA no toca inventario', async () => {
  await reseed();
  const A = await actors();
  const [a1, a2] = [await idOf('A-001'), await idOf('A-002')];
  assert.equal((await call(A, a1, 'reserve')).status, 200);
  assert.equal((await call(A, a1, 'cancel')).status, 200);
  assert.equal(await statusOf(a1), 'CANCELADA');
  assert.deepEqual(await stock('ORG-A', sku), { on_hand: 10, reserved: 0 });
  assert.equal((await call(A, a2, 'cancel')).status, 200);
  assert.equal(await statusOf(a2), 'CANCELADA');
  assert.deepEqual(await stock('ORG-A', sku), { on_hand: 10, reserved: 0 });
});

// ---------- Transiciones denegadas: 409, estado e inventario intactos ----------
const PATH = {
  ENVIADA: [], RESERVADA: ['reserve'], DESPACHADA: ['reserve', 'dispatch'],
  ENTREGADA: ['reserve', 'dispatch', 'deliver'], CANCELADA: ['cancel'],
};
const STOCK = { ENVIADA: [10, 0], RESERVADA: [10, 7], DESPACHADA: [3, 0], ENTREGADA: [3, 0], CANCELADA: [10, 0] };
const DENIED = {
  ENVIADA: ['submit', 'dispatch', 'deliver'],
  RESERVADA: ['submit', 'reserve', 'deliver'],
  DESPACHADA: ['submit', 'reserve', 'dispatch', 'cancel'],
  ENTREGADA: ['submit', 'reserve', 'dispatch', 'deliver', 'cancel'],
  CANCELADA: ['submit', 'reserve', 'dispatch', 'deliver', 'cancel'],
};
for (const [state, ops] of Object.entries(DENIED)) {
  test(`transiciones denegadas desde ${state}: ${ops.join(', ')} dan 409 sin cambios`, async () => {
    await reseed();
    const A = await actors();
    const a1 = await idOf('A-001');
    for (const step of PATH[state]) assert.equal((await call(A, a1, step)).status, 200, `preparar ${state}: ${step}`);
    assert.equal(await statusOf(a1), state);
    const [onHand, reserved] = STOCK[state];
    for (const name of ops) {
      const r = await call(A, a1, name);
      assert.equal(r.status, 409, `${state} + ${name}`);
      assert.equal(await statusOf(a1), state, `${state} + ${name}: el estado no debe cambiar`);
      assert.deepEqual(await stock('ORG-A', sku), { on_hand: onHand, reserved }, `${state} + ${name}: el inventario no debe cambiar`);
    }
  });
}

test('transiciones denegadas desde BORRADOR: reserve, dispatch, deliver y cancel dan 409', async () => {
  await reseed();
  const A = await actors();
  const d = await A.solicitante('POST', '/requests', VALID);
  assert.equal(d.status, 201);
  for (const name of ['reserve', 'dispatch', 'deliver', 'cancel']) {
    assert.equal((await call(A, d.body.id, name)).status, 409, `BORRADOR + ${name}`);
    assert.equal(await statusOf(d.body.id), 'BORRADOR');
    assert.deepEqual(await stock('ORG-A', sku), { on_hand: 10, reserved: 0 });
  }
});
