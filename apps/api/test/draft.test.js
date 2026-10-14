// Edición de borradores: PUT /requests/:id (RF04, RNF01). Oráculo: lectura directa de la base.
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
const nLines = async (id) => (await owner.query('SELECT count(*)::int AS n FROM request_lines WHERE request_id=$1', [id])).rows[0].n;
const twoSkus = async () => (await owner.query('SELECT code FROM skus ORDER BY code LIMIT 2')).rows.map((r) => r.code);

const ORIGINAL = { zone: 'NORTE', priority: 'NORMAL', requiredDate: '2030-01-15', lines: [{ sku: 'KIT-ALIMENTO', quantity: 1 }] };

test('PUT sin sesión responde 401', async () => {
  const r = await fetch(`${base}/requests/00000000-0000-4000-8000-000000000000`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 401);
});

test('el solicitante edita su borrador: cambian los datos y las líneas, el estado y el inventario no', async () => {
  await reseed();
  const sol = await who('a', 'solicitante');
  const d = await sol('POST', '/requests', ORIGINAL);
  assert.equal(d.status, 201);
  const [s1, s2] = await twoSkus();
  const r = await sol('PUT', `/requests/${d.body.id}`, {
    zone: 'SUR', priority: 'ALTA', requiredDate: '2030-02-20', notes: 'Cambio de zona',
    lines: [{ sku: s1, quantity: 3 }, { sku: s2, quantity: 2 }],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await row(d.body.id), { zone: 'SUR', priority: 'ALTA', notes: 'Cambio de zona', status: 'BORRADOR' });
  assert.equal(await nLines(d.body.id), 2);
  assert.deepEqual(await stock('ORG-A', 'KIT-ALIMENTO'), { on_hand: 10, reserved: 0 });
});

test('edición con cantidad 0: 422 y el borrador queda como estaba', async () => {
  await reseed();
  const sol = await who('a', 'solicitante');
  const d = await sol('POST', '/requests', ORIGINAL);
  const r = await sol('PUT', `/requests/${d.body.id}`, { ...ORIGINAL, zone: 'SUR', lines: [{ sku: 'KIT-ALIMENTO', quantity: 0 }] });
  assert.equal(r.status, 422);
  assert.equal((await row(d.body.id)).zone, 'NORTE');
  assert.equal(await nLines(d.body.id), 1);
});

test('una solicitud ENVIADA no se edita: 409 sin cambios', async () => {
  await reseed();
  const sol = await who('a', 'solicitante');
  const d = await sol('POST', '/requests', ORIGINAL);
  assert.equal((await sol('POST', `/requests/${d.body.id}/submit`)).status, 200);
  const r = await sol('PUT', `/requests/${d.body.id}`, { ...ORIGINAL, zone: 'SUR' });
  assert.equal(r.status, 409);
  assert.deepEqual(await row(d.body.id), { zone: 'NORTE', priority: 'NORMAL', notes: null, status: 'ENVIADA' });
});

test('seguridad: el coordinador recibe 403 y el solicitante de ORG-B recibe 404, sin cambios', async () => {
  await reseed();
  const sol = await who('a', 'solicitante'), coord = await who('a', 'coordinador'), solB = await who('b', 'solicitante');
  const d = await sol('POST', '/requests', ORIGINAL);
  assert.equal((await coord('PUT', `/requests/${d.body.id}`, { ...ORIGINAL, zone: 'SUR' })).status, 403);
  assert.equal((await solB('PUT', `/requests/${d.body.id}`, { ...ORIGINAL, zone: 'SUR' })).status, 404);
  assert.equal((await row(d.body.id)).zone, 'NORTE');
});
