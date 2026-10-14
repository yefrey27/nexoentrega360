// NexoEntrega 360: interfaz sin framework. Todo texto que viene del servidor se inserta con textContent (nunca innerHTML).
const FLOW = ['BORRADOR', 'ENVIADA', 'RESERVADA', 'DESPACHADA', 'ENTREGADA'];
const STATUSES = [...FLOW, 'CANCELADA'];
const $ = (s) => document.querySelector(s);
let me = null;
const q = { status: '', priority: '', zone: '', page: 1 };
const selected = new Set(); // solicitudes marcadas para el resumen de IA
const refresh = {};
let uid = 0;

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== false && kid != null) e.append(kid instanceof Node ? kid : String(kid));
  return e;
}

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Error ${res.status}`);
    err.status = res.status;
    err.fields = data?.error?.fields || [];
    throw err;
  }
  return data;
}

function say(msg, kind = 'ok', fields = []) {
  $('#live').replaceChildren(h('p', { class: kind }, msg, fields.length > 0 && h('ul', {}, fields.map((f) => h('li', {}, `${f.field}: ${f.message}`)))));
}
function fail(err) {
  if (err.status === 401 && me) { me = null; loginView(); say('Su sesión terminó. Inicie sesión de nuevo.', 'error'); return; }
  say(err.message, 'error', err.fields);
}
const fmt = (iso) => `${new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota' })} (hora de Bogotá)`;

// ---- Errores asociados a su campo (aria-describedby) ----
function clearErrors(root) {
  root.querySelectorAll('.err').forEach((e) => e.remove());
  root.querySelectorAll('[aria-invalid]').forEach((e) => { e.removeAttribute('aria-invalid'); e.removeAttribute('aria-describedby'); });
}
function attachError(el, message) {
  const p = h('p', { class: 'err', id: `err-${++uid}` }, message);
  el.setAttribute('aria-invalid', 'true');
  el.setAttribute('aria-describedby', p.id);
  (el.tagName === 'FIELDSET' ? el : el.parentElement).append(p);
}
function showFieldErrors(form, fields) {
  for (const f of fields) {
    const m = /^lines\[(\d+)\]\.(sku|quantity)$/.exec(f.field);
    const el = m ? form.querySelectorAll('.line')[m[1]]?.querySelector(`[name=${m[2]}]`) : f.field === 'lines' ? form.querySelector('fieldset') : form.elements[f.field];
    if (el) attachError(el, f.message);
  }
  form.querySelector('[aria-invalid]')?.focus();
}
const field = (label, input) => { const id = `f-${++uid}`; input.id = id; return h('div', { class: 'field' }, h('label', { for: id }, label), input); };

// ---- Inicio de sesión ----
function header() {
  $('#top').replaceChildren(
    h('strong', {}, 'NexoEntrega 360'),
    me ? h('div', { class: 'who' }, `${me.displayName} · ${me.organization.code} · ${me.role} `,
      h('button', { class: 'ghost', type: 'button', onclick: logout }, 'Cerrar sesión')) : '',
  );
}
function loginView() {
  header();
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); clearErrors(form);
    try { me = await api('/auth/login', { method: 'POST', body: { email: form.elements.email.value.trim(), password: form.elements.password.value } }); say(`Bienvenido, ${me.displayName}`); appView(); $('#app').focus(); }
    catch (err) { fail(err); showFieldErrors(form, err.fields); }
  } },
    field('Correo', h('input', { name: 'email', type: 'email', autocomplete: 'username', required: true })),
    field('Contraseña', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
    h('button', { type: 'submit' }, 'Iniciar sesión'),
  );
  $('#app').replaceChildren(h('section', { class: 'panel' }, h('h2', {}, 'Iniciar sesión'), form,
    h('p', { class: 'demo' }, 'Cuentas de demostración (ficticias): ', h('code', {}, 'org-a-solicitante@example.test'), ', ', h('code', {}, 'org-a-coordinador@example.test'),
      ', ', h('code', {}, 'org-a-bodega@example.test'), ', ', h('code', {}, 'org-a-auditor@example.test'), ' (y las de org-b). Contraseña: ', h('code', {}, 'Nexo-Demo-2026'))));
}
async function logout() { try { await api('/auth/logout', { method: 'POST' }); } catch { /* ya sin sesión */ } me = null; selected.clear(); loginView(); say('Sesión cerrada.'); }

// ---- Vista principal según el rol ----
function appView() {
  header();
  Object.keys(refresh).forEach((k) => delete refresh[k]); // no arrastrar funciones del rol anterior
  const panels = [];
  if (me.role !== 'SOLICITANTE') panels.push(dashboardPanel());
  if (me.role === 'SOLICITANTE') panels.push(formPanel());
  panels.push(requestsPanel());
  if (me.role === 'COORDINADOR') panels.push(aiPanel());
  if (me.role === 'AUDITOR') panels.push(auditPanel());
  $('#app').replaceChildren(...panels);
  Object.values(refresh).forEach((f) => f());
}

function dashboardPanel() {
  const box = h('div', {});
  refresh.dashboard = async () => {
    try {
      const d = await api('/dashboard');
      box.replaceChildren(
        h('div', { class: 'stats' }, STATUSES.map((s) => h('span', {}, `${s}: ${d.byStatus[s] ?? 0}`))),
        h('div', { class: 'inv' }, h('b', {}, 'SKU'), h('b', { class: 'num' }, 'Físico'), h('b', { class: 'num' }, 'Reservado'), h('b', { class: 'num' }, 'Disponible'),
          d.inventory.flatMap((i) => [h('span', {}, i.sku), h('span', { class: 'num' }, i.onHand), h('span', { class: 'num' }, i.reserved), h('span', { class: 'num' }, i.available)])));
    } catch (e) { fail(e); }
  };
  return h('section', { class: 'panel', 'aria-labelledby': 'h-dash' }, h('h2', { id: 'h-dash' }, 'Tablero'), box);
}

function formPanel() {
  const form = h('form', { novalidate: true });
  const linesBox = h('fieldset', { class: 'field' }, h('legend', {}, 'Líneas (1 a 10, SKU distintos)'));
  const addLine = () => {
    const row = h('div', { class: 'line' },
      field('SKU', h('input', { name: 'sku', list: 'skus', required: true, autocomplete: 'off' })),
      field('Cantidad', h('input', { name: 'quantity', type: 'number', min: 1, max: 500, step: 1, required: true, value: 1 })),
      h('button', { type: 'button', class: 'ghost', onclick: () => { if (linesBox.querySelectorAll('.line').length > 1) row.remove(); } }, 'Quitar'));
    linesBox.insertBefore(row, linesBox.querySelector('.add'));
  };
  linesBox.append(h('button', { type: 'button', class: 'ghost add', onclick: () => linesBox.querySelectorAll('.line').length < 10 && addLine() }, 'Añadir línea'));
  addLine();
  const inAWeek = new Date(Date.now() - 5 * 3600e3 + 7 * 864e5).toISOString().slice(0, 10);
  form.append(
    h('div', { class: 'row' },
      field('Zona', h('select', { name: 'zone' }, ['NORTE', 'SUR', 'CENTRO', 'RIBERA'].map((z) => h('option', { value: z }, z)))),
      field('Prioridad', h('select', { name: 'priority' }, h('option', { value: 'NORMAL' }, 'NORMAL'), h('option', { value: 'ALTA' }, 'ALTA'))),
      field('Fecha requerida', h('input', { name: 'requiredDate', type: 'date', value: inAWeek }))),
    field('Observaciones (opcional, máx. 500)', h('textarea', { name: 'notes', maxlength: 500 })),
    linesBox,
    h('button', { type: 'submit' }, 'Guardar borrador'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); clearErrors(form);
    const body = {
      zone: form.elements.zone.value, priority: form.elements.priority.value, requiredDate: form.elements.requiredDate.value,
      lines: [...form.querySelectorAll('.line')].map((r) => ({ sku: r.querySelector('[name=sku]').value.trim().toUpperCase(), quantity: Number(r.querySelector('[name=quantity]').value) })),
    };
    if (form.elements.notes.value.trim()) body.notes = form.elements.notes.value.trim();
    try { const r = await api('/requests', { method: 'POST', body }); say(`Borrador ${r.code} creado. Envíelo desde la lista.`); form.reset(); refresh.list(); }
    catch (err) { fail(err); showFieldErrors(form, err.fields); }
  });
  return h('section', { class: 'panel', 'aria-labelledby': 'h-new' }, h('h2', { id: 'h-new' }, 'Nueva solicitud'), form);
}

// ---- Listado de solicitudes ----
function pager(page, pageSize, total, go) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return h('div', { class: 'pager' },
    h('button', { type: 'button', class: 'ghost', disabled: page <= 1, onclick: () => go(page - 1) }, 'Anterior'),
    h('span', {}, `Página ${page} de ${pages} (${total} en total)`),
    h('button', { type: 'button', class: 'ghost', disabled: page >= pages, onclick: () => go(page + 1) }, 'Siguiente'));
}

function requestsPanel() {
  const list = h('div', {});
  const sel = (name, label, values) => field(label, h('select', { name, onchange: (e) => { q[name] = e.target.value; q.page = 1; refresh.list(); } },
    h('option', { value: '' }, 'Todos'), values.map((v) => h('option', { value: v }, v))));
  refresh.list = async () => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '')).toString();
    try {
      const d = await api(`/requests?${qs}`);
      list.replaceChildren(...(d.items.length ? d.items.map(card) : [h('p', { class: 'hint' }, 'No hay solicitudes con estos filtros.')]), pager(d.page, d.pageSize, d.total, (p) => { q.page = p; refresh.list(); }));
    } catch (e) { fail(e); }
  };
  return h('section', { class: 'panel', 'aria-labelledby': 'h-list' }, h('h2', { id: 'h-list' }, me.role === 'SOLICITANTE' ? 'Mis solicitudes' : 'Solicitudes de la organización'),
    h('div', { class: 'filters' }, sel('status', 'Estado', STATUSES), sel('priority', 'Prioridad', ['NORMAL', 'ALTA']), sel('zone', 'Zona', ['NORTE', 'SUR', 'CENTRO', 'RIBERA'])), list);
}

function card(r) {
  const role = me.role;
  const act = (label, op, cls = '') => h('button', { type: 'button', class: cls, onclick: async () => {
    try {
      await api(`/requests/${r.id}/${op}`, { method: 'POST', headers: op === 'reserve' ? { 'Idempotency-Key': crypto.randomUUID() } : {} });
      selected.delete(r.id); say(`${r.code}: ${label.toLowerCase()} realizado.`); refresh.list(); refresh.dashboard?.(); refresh.audit?.();
    } catch (e) { fail(e); }
  } }, label);
  const actions = [];
  if (role === 'SOLICITANTE' && r.status === 'BORRADOR') actions.push(act('Enviar', 'submit'));
  if (role === 'SOLICITANTE' && ['ENVIADA', 'RESERVADA'].includes(r.status)) actions.push(act('Cancelar', 'cancel', 'danger'));
  if (role === 'COORDINADOR' && r.status === 'ENVIADA') actions.push(act('Reservar', 'reserve'));
  if (role === 'COORDINADOR' && r.status === 'DESPACHADA') actions.push(act('Registrar entrega', 'deliver'));
  if (role === 'BODEGA' && r.status === 'RESERVADA') actions.push(act('Despachar', 'dispatch'));

  const hist = h('div', {});
  const histBtn = h('button', { type: 'button', class: 'ghost', 'aria-expanded': 'false', onclick: async () => {
    if (histBtn.getAttribute('aria-expanded') === 'true') { hist.replaceChildren(); histBtn.setAttribute('aria-expanded', 'false'); return; }
    try {
      const d = await api(`/requests/${r.id}`);
      hist.replaceChildren(h('ul', { class: 'history' }, d.history.map((e) => h('li', {}, `${e.action}: ${e.fromStatus ?? 'sin estado'} → ${e.toStatus ?? 'sin estado'}, ${e.actorRole}, ${fmt(e.occurredAt)}`))));
      histBtn.setAttribute('aria-expanded', 'true');
    } catch (e) { fail(e); }
  } }, 'Historial');
  const pick = role === 'COORDINADOR' && r.status === 'ENVIADA' && h('label', { class: 'hint' },
    h('input', { type: 'checkbox', style: 'width:auto', checked: selected.has(r.id), onchange: (e) => (e.target.checked ? selected.add(r.id) : selected.delete(r.id)) }), ' Incluir en el resumen de IA');

  return h('article', { class: 'req' },
    h('header', {}, h('h3', {}, r.code), h('span', { class: `status ${r.status}` }, `Estado: ${r.status}`)),
    h('ol', { class: 'rail', 'aria-hidden': 'true' }, FLOW.map((s, i) => h('li', { class: r.status === 'CANCELADA' ? 'cancel' : i <= FLOW.indexOf(r.status) ? 'done' : '' }))),
    h('p', { class: 'meta' }, `Zona ${r.zone}. Prioridad `, h('span', { class: r.priority === 'ALTA' ? 'alta' : '' }, r.priority), `. Requerida ${r.requiredDate}.`),
    h('p', { class: 'meta' }, r.lines.map((l) => `${l.sku} × ${l.quantity}`).join(', ')),
    r.notes && h('p', { class: 'hint' }, `Observaciones: ${r.notes}`),
    pick, h('div', { class: 'actions' }, actions, histBtn), hist);
}

// ---- Asistente de IA (solo coordinador) ----
function aiPanel() {
  const out = h('div', { 'aria-live': 'polite' });
  const show = (d) => out.replaceChildren(h('div', { class: 'draft' },
    h('p', { class: 'tag' }, d.label), d.message && h('p', { class: 'hint' }, d.message),
    h('p', {}, d.summary),
    h('ul', {}, d.recommendations.map((r) => h('li', {}, `${r.requestId}: ${r.reason} (evidencia: ${r.evidenceFields.join(', ')})`))),
    d.approvedAt ? h('p', { class: 'hint' }, `Aprobado el ${fmt(d.approvedAt)}.`)
      : h('button', { type: 'button', onclick: async () => { try { show(await api(`/ai/summaries/${d.id}/approve`, { method: 'POST' })); say('Resumen aprobado. No se cambió ninguna solicitud.'); refresh.audit?.(); } catch (e) { fail(e); } } }, 'Aprobar borrador'),
    h('p', { class: 'hint' }, 'Es una recomendación: revise los datos de cada solicitud antes de actuar. Aprobar no reserva ni despacha.')));
  return h('section', { class: 'panel', 'aria-labelledby': 'h-ai' }, h('h2', { id: 'h-ai' }, 'Resumen con asistente de IA'),
    h('p', { class: 'hint' }, 'Marque hasta 20 solicitudes ENVIADA en la lista.'),
    h('button', { type: 'button', onclick: async () => {
      if (!selected.size) return say('Marque al menos una solicitud ENVIADA.', 'error');
      try { show(await api('/ai/summaries', { method: 'POST', body: { requestIds: [...selected] } })); } catch (e) { fail(e); }
    } }, 'Resumir seleccionadas'), out);
}

// ---- Auditoría (solo auditor) ----
function auditPanel() {
  const box = h('div', {});
  let page = 1;
  refresh.audit = async () => {
    try {
      const d = await api(`/audit-events?page=${page}`);
      box.replaceChildren(h('ul', { class: 'history' }, d.items.map((e) => h('li', {}, `${fmt(e.occurredAt)}: ${e.action} ${e.resourceType} ${e.resourceId.slice(0, 8)}, ${e.fromStatus ?? '-'} → ${e.toStatus ?? '-'}, ${e.actorRole}, correlación ${e.correlationId.slice(0, 8)}`))),
        pager(d.page, d.pageSize, d.total, (p) => { page = p; refresh.audit(); }));
    } catch (e) { fail(e); }
  };
  return h('section', { class: 'panel', 'aria-labelledby': 'h-aud' }, h('h2', { id: 'h-aud' }, 'Auditoría'), box);
}

(async () => { try { me = await api('/me'); appView(); } catch { loginView(); } })();
