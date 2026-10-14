// Idempotencia de la reserva (RF07, RNF02). Oráculo: lectura directa de la base.
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
const status = async (id) => (await owner.query('SELECT status FROM requests WHERE id=$1', [id])).rows[0].status;
const nKeys = async (key) => (await owner.query('SELECT count(*)::int AS n FROM idempotency_keys WHERE key=$1', [key])).rows[0].n;

const SKU = 'KIT-AGUA';
// SUPOSICIÓN: rutas POST /requests y POST /requests/:id/submit; ajustar según flow.test.js.
async function crearEnviada(sol, quantity) {
  const c = await sol('POST', '/requests', { zone: 'NORTE', priority: 'NORMAL', requiredDate: '2030-01-15', lines: [{ sku: SKU, quantity }] });
  assert.equal(c.status, 201);
  const s = await sol('POST', `/requests/${c.body.id}/submit`);
  assert.equal(s.status, 200);
  return c.body.id;
}

test('misma clave y mismo contenido dos veces: mismo resultado y un solo efecto', async () => {
  await reseed();
  const sol = await who('a', 'solicitante'), coord = await who('a', 'coordinador');
  const id = await crearEnviada(sol, 2);
  const antes = await stock('ORG-A', SKU);
  const h = { 'Idempotency-Key': 'idem-caso-1' };
  const r1 = await coord('POST', `/requests/${id}/reserve`, null, h);
  const r2 = await coord('POST', `/requests/${id}/reserve`, null, h);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, r1.status);
  assert.deepEqual(r2.body, r1.body);
  const despues = await stock('ORG-A', SKU);
  assert.equal(despues.reserved, antes.reserved + 2);
  assert.equal(despues.on_hand, antes.on_hand);
  assert.equal(await status(id), 'RESERVADA');
  assert.equal(await nKeys('idem-caso-1'), 1);
});

test('misma clave con contenido distinto: 409 y la segunda solicitud no cambia', async () => {
  await reseed();
  const sol = await who('a', 'solicitante'), coord = await who('a', 'coordinador');
  const id1 = await crearEnviada(sol, 2), id2 = await crearEnviada(sol, 3);
  const h = { 'Idempotency-Key': 'idem-caso-2' };
  assert.equal((await coord('POST', `/requests/${id1}/reserve`, null, h)).status, 200);
  const antes = await stock('ORG-A', SKU);
  const r = await coord('POST', `/requests/${id2}/reserve`, null, h);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(await status(id2), 'ENVIADA');
  assert.deepEqual(await stock('ORG-A', SKU), antes);
});

test('misma clave de otro usuario: no recibe la respuesta ajena', async () => {
  await reseed();
  const solA = await who('a', 'solicitante'), coordA = await who('a', 'coordinador');
  const solB = await who('b', 'solicitante'), coordB = await who('b', 'coordinador');
  const idA = await crearEnviada(solA, 2), idB = await crearEnviada(solB, 1);
  const h = { 'Idempotency-Key': 'idem-caso-3' };
  const rA = await coordA('POST', `/requests/${idA}/reserve`, null, h);
  assert.equal(rA.status, 200);
  const bAntes = await stock('ORG-B', SKU);
  const rB = await coordB('POST', `/requests/${idB}/reserve`, null, h);
  assert.equal(rB.status, 200);
  assert.notDeepEqual(rB.body, rA.body);
  assert.equal(JSON.stringify(rB.body).includes(idA), false);
  assert.equal((await stock('ORG-B', SKU)).reserved, bAntes.reserved + 1);
  assert.equal(await status(idB), 'RESERVADA');
  const solA2 = await crearEnviada(solA, 1);
  const aAntes = await stock('ORG-A', SKU);
  assert.equal((await coordB('POST', `/requests/${solA2}/reserve`, null, h)).status, 404);
  assert.equal(await status(solA2), 'ENVIADA');
  assert.deepEqual(await stock('ORG-A', SKU), aAntes);
});

test('segunda reserva con otra clave: 409 y el inventario no cambia', async () => {
  await reseed();
  const sol = await who('a', 'solicitante'), coord = await who('a', 'coordinador');
  const id = await crearEnviada(sol, 2);
  assert.equal((await coord('POST', `/requests/${id}/reserve`, null, { 'Idempotency-Key': 'idem-caso-4a' })).status, 200);
  const antes = await stock('ORG-A', SKU);
  assert.equal((await coord('POST', `/requests/${id}/reserve`, null, { 'Idempotency-Key': 'idem-caso-4b' })).status, 409);
  assert.deepEqual(await stock('ORG-A', SKU), antes);
});

test('reserva sin Idempotency-Key: 400 y sin efectos', async () => {
  await reseed();
  const sol = await who('a', 'solicitante'), coord = await who('a', 'coordinador');
  const id = await crearEnviada(sol, 2);
  const antes = await stock('ORG-A', SKU);
  const r = await coord('POST', `/requests/${id}/reserve`, null);
  assert.equal(r.status, 400);
  assert.equal(await status(id), 'ENVIADA');
  assert.deepEqual(await stock('ORG-A', SKU), antes);
});
