'use strict';
// Consola de operación de cuentas. Todo el texto que viene de los datos (nombres de consulta, correos, motivos) se inserta
// con textContent: nunca como HTML, porque lo escriben las propias cuentas.

const $ = (s, el = document) => el.querySelector(s);
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue; // un atributo ausente no se escribe como «undefined»
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'disabled' || k === 'value' || k === 'checked') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}
const csrf = () => decodeURIComponent((document.cookie.split('; ').find((c) => c.startsWith('XSRF-TOKEN=')) || '').split('=')[1] || '');
async function api(method, path, body) {
  const r = await fetch('/api/v1/platform' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf() }, body: body ? JSON.stringify(body) : undefined });
  const j = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || 'Error ' + r.status), { status: r.status });
  return j;
}

const date = (v) => (v ? new Date(v).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const day = (v) => (v ? new Date(v).toLocaleDateString('es-MX', { dateStyle: 'medium' }) : '—');
const mxn = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);
const bytes = (n) => (n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB');
const PLAN = { free: 'Gratuito', standard: 'Estándar', pro: 'Pro' };
const STATE = { free: ['Gratuito', ''], trialing: ['En prueba', 'b-warn'], active: ['Activo', 'b-ok'], past_due: ['Cobro fallido', 'b-bad'], canceled: ['Cancelado', 'b-warn'], expired: ['Vencido', 'b-bad'] };
const KIND = { comp_plan: 'Plan de cortesía', extend_trial: 'Extender prueba', refund: 'Reembolso' };
const ASTATUS = { pending: 'Pendiente', rejected: 'Rechazada', executed: 'Ejecutada', failed: 'Falló' };

const app = $('#app');
let tab = 'accounts';

function badge(text, cls) { return h('span', { class: 'badge ' + (cls || '') }, text); }
function stateBadge(s) { const [t, c] = STATE[s] || [s, '']; return badge(t, c); }
function fail(e) {
  if (e.status === 401) return app.replaceChildren(h('p', { class: 'err' }, 'Tu sesión terminó. Inicia sesión en la aplicación con una cuenta de plataforma y vuelve a abrir esta página.'));
  if (e.status === 403) return app.replaceChildren(h('p', { class: 'err' }, 'Esta cuenta no tiene acceso a la operación de cuentas.'));
  app.replaceChildren(h('p', { class: 'err' }, e.message));
}

// Diálogo de formulario: campos [{name,label,type,options,required,value}] y devuelve los valores al enviar.
function ask(title, fields, submitLabel, onSubmit) {
  const dlg = $('#dlg');
  const err = h('p', { class: 'err', role: 'alert' });
  const form = h('form', { method: 'dialog' }, h('h2', {}, title),
    fields.map((f) => h('label', {}, f.label, f.type === 'select'
      ? h('select', { name: f.name }, f.options.map(([v, t]) => h('option', { value: v }, t)))
      : f.type === 'textarea' ? h('textarea', { name: f.name, rows: '3', required: 'required' }) : h('input', { name: f.name, type: f.type || 'text', value: f.value ?? '', required: f.required === false ? undefined : 'required' }))),
    err,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, submitLabel), h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancelar')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    try { await onSubmit(v); dlg.close(); } catch (e) { err.textContent = e.message; }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
}

function nav() {
  const t = $('#tabs');
  const mk = (id, label) => h('button', { type: 'button', 'aria-current': String(tab === id), onclick: () => { tab = id; show(); } }, label);
  t.replaceChildren(mk('accounts', 'Cuentas'), mk('actions', 'Aprobaciones'));
}

async function show() { nav(); try { await (tab === 'accounts' ? accounts() : approvals()); } catch (e) { fail(e); } }

async function accounts() {
  const q = h('input', { type: 'search', placeholder: 'Buscar por nombre o correo', 'aria-label': 'Buscar' });
  const plan = h('select', { 'aria-label': 'Plan' }, [['', 'Todos los planes'], ['free', 'Gratuito'], ['standard', 'Estándar'], ['pro', 'Pro']].map(([v, t]) => h('option', { value: v }, t)));
  const st = h('select', { 'aria-label': 'Estado de la cuenta' }, [['', 'Todas'], ['active', 'Activas'], ['suspended', 'Suspendidas']].map(([v, t]) => h('option', { value: v }, t)));
  const body = h('div');
  const load = async () => {
    const p = await api('GET', '/accounts?limit=50&q=' + encodeURIComponent(q.value) + '&plan=' + plan.value + '&status=' + st.value);
    body.replaceChildren(h('p', { class: 'muted' }, p.total + ' cuenta(s)'), h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Consulta', 'Titular', 'Plan', 'Estado', 'Pacientes activos', 'Alta'].map((t) => h('th', {}, t)))),
      h('tbody', {}, p.items.map((a) => h('tr', { class: 'row', tabindex: '0', onclick: () => detail(a.id), onkeydown: (e) => { if (e.key === 'Enter') detail(a.id); } },
        h('td', {}, a.name, ' ', a.status !== 'active' && badge('Suspendida', 'b-bad')), h('td', {}, a.owner_email),
        h('td', {}, PLAN[a.effective_plan], a.effective_plan !== a.plan && h('span', { class: 'muted' }, ' (contrató ' + PLAN[a.plan] + ')')),
        h('td', {}, stateBadge(a.state), a.comped && ' ', a.comped && badge('Cortesía')), h('td', { class: 'num' }, a.active_patients), h('td', {}, day(a.created_at))))))));
  };
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load().catch(fail), 300); });
  plan.addEventListener('change', () => load().catch(fail));
  st.addEventListener('change', () => load().catch(fail));
  app.replaceChildren(h('div', { class: 'bar' }, q, plan, st), body);
  await load();
}

async function detail(id) {
  const d = await api('GET', '/accounts/' + id);
  const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
  const refundable = d.payments.filter((p) => p.status === 'paid');
  app.replaceChildren(
    h('p', {}, h('button', { class: 'btn', type: 'button', onclick: show }, '← Cuentas')),
    h('div', { class: 'card' }, h('h2', {}, d.name, ' ', d.status !== 'active' && badge('Suspendida', 'b-bad')),
      d.suspended_reason && h('p', { class: 'err' }, 'Motivo de la suspensión: ' + d.suspended_reason),
      h('dl', { class: 'grid' }, row('Titular', d.owner_email), row('Alta', day(d.created_at)), row('Personas con acceso', d.users),
        row('Plan contratado', PLAN[d.plan] + (d.billing_period ? ' · ' + (d.billing_period === 'annual' ? 'anual' : 'mensual') : '')),
        row('Plan vigente', PLAN[d.effective_plan]), row('Estado', [stateBadge(d.state), d.ends_at ? ' hasta ' + day(d.ends_at) : '']),
        row('Cortesía', d.comp_reason || 'No'), row('Prueba usada', d.trial_used ? 'Sí' : 'No'), row('Tarjeta', d.card || '—'), row('Pasarela', d.provider || '—'),
        row('Pacientes activos', d.active_patients + (d.limits.active_patients < 0 ? '' : ' de ' + d.limits.active_patients)), row('Archivos', bytes(d.storage_bytes))),
      h('div', { class: 'actions' },
        d.status === 'active'
          ? h('button', { class: 'btn danger', type: 'button', onclick: () => ask('Suspender cuenta', [{ name: 'reason', label: 'Motivo (queda en la bitácora)', type: 'textarea' }], 'Suspender', async (v) => { await api('POST', `/accounts/${id}/suspend`, v); detail(id); }) }, 'Suspender')
          : h('button', { class: 'btn', type: 'button', onclick: async () => { await api('POST', `/accounts/${id}/reactivate`); detail(id); } }, 'Reactivar'),
        h('button', { class: 'btn', type: 'button', onclick: () => ask('Pedir plan de cortesía', [
          { name: 'plan', label: 'Plan', type: 'select', options: [['standard', 'Estándar'], ['pro', 'Pro']] },
          { name: 'days', label: 'Días de cortesía (máx. 366)', type: 'number', value: 30 },
          { name: 'reason', label: 'Motivo', type: 'textarea' }], 'Pedir aprobación', async (v) => { await api('POST', `/accounts/${id}/actions`, { kind: 'comp_plan', params: { plan: v.plan, days: Number(v.days) }, reason: v.reason }); detail(id); }) }, 'Plan de cortesía…'),
        d.state === 'trialing' && h('button', { class: 'btn', type: 'button', onclick: () => ask('Pedir prórroga de la prueba', [
          { name: 'days', label: 'Días extra (máx. 30)', type: 'number', value: 7 }, { name: 'reason', label: 'Motivo', type: 'textarea' }], 'Pedir aprobación', async (v) => { await api('POST', `/accounts/${id}/actions`, { kind: 'extend_trial', params: { days: Number(v.days) }, reason: v.reason }); detail(id); }) }, 'Extender prueba…'),
        refundable.length > 0 && h('button', { class: 'btn', type: 'button', onclick: () => ask('Pedir reembolso', [
          { name: 'payment_id', label: 'Cobro', type: 'select', options: refundable.map((p) => [p.id, `${day(p.occurred_at)} · ${PLAN[p.plan]} · ${mxn(p.amount_mxn)}`]) },
          { name: 'reason', label: 'Motivo', type: 'textarea' }], 'Pedir aprobación', async (v) => { await api('POST', `/accounts/${id}/actions`, { kind: 'refund', params: { payment_id: v.payment_id }, reason: v.reason }); detail(id); }) }, 'Reembolsar…')),
      h('p', { class: 'muted' }, 'Plan de cortesía, prórroga y reembolso necesitan la aprobación de otra persona (pestaña Aprobaciones).')),
    h('div', { class: 'card' }, h('h3', {}, 'Solicitudes de esta cuenta'), actionsTable(d.actions, false, () => detail(id))),
    h('div', { class: 'card' }, h('h3', {}, 'Cobros'), d.payments.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Fecha', 'Plan', 'Importe', 'Estado'].map((t) => h('th', {}, t)))),
      h('tbody', {}, d.payments.map((p) => h('tr', {}, h('td', {}, date(p.occurred_at)), h('td', {}, PLAN[p.plan]), h('td', { class: 'num' }, mxn(p.amount_mxn)), h('td', {}, p.status + (p.failure_reason ? ' · ' + p.failure_reason : '')))))) : h('p', { class: 'muted' }, 'Sin cobros.')),
    h('div', { class: 'card' }, h('h3', {}, 'Actividad reciente'), d.audit.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Fecha', 'Acción', 'Quién'].map((t) => h('th', {}, t)))),
      h('tbody', {}, d.audit.map((a) => h('tr', {}, h('td', {}, date(a.occurred_at)), h('td', {}, a.action), h('td', {}, a.actor || '—'))))) : h('p', { class: 'muted' }, 'Sin actividad.')),
  );
}

function actionsTable(items, withPractice, after) {
  if (!items.length) return h('p', { class: 'muted' }, 'Sin solicitudes.');
  const desc = (a) => a.kind === 'comp_plan' ? `${PLAN[a.params.plan]} por ${a.params.days} días` : a.kind === 'extend_trial' ? `+${a.params.days} días de prueba` : 'Cobro ' + a.params.payment_id.slice(0, 8);
  return h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, [withPractice && 'Consulta', 'Acción', 'Detalle', 'Motivo', 'Pidió', 'Estado', ''].filter(Boolean).map((t) => h('th', {}, t)))),
    h('tbody', {}, items.map((a) => h('tr', {}, withPractice && h('td', {}, a.practice_name), h('td', {}, KIND[a.kind]), h('td', {}, desc(a)), h('td', {}, a.reason), h('td', {}, a.requested_by_email || '—', h('div', { class: 'muted' }, date(a.requested_at))),
      h('td', {}, ASTATUS[a.status], a.error && h('div', { class: 'err' }, a.error)),
      h('td', {}, a.status === 'pending' && h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => decide(a, true, after) }, 'Aprobar'), h('button', { class: 'btn', type: 'button', onclick: () => decide(a, false, after) }, 'Rechazar'))))))));
}

function decide(a, approve, after) {
  ask(approve ? 'Aprobar solicitud' : 'Rechazar solicitud', [{ name: 'note', label: 'Nota (opcional)', type: 'text', required: false }], approve ? 'Aprobar y ejecutar' : 'Rechazar',
    async (v) => { await api('POST', `/actions/${a.id}/decision`, { approve, note: v.note }); after(); });
}

async function approvals() {
  const [pending, all] = await Promise.all([api('GET', '/actions?status=pending'), api('GET', '/actions')]);
  app.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Pendientes de aprobar (' + pending.items.length + ')'), actionsTable(pending.items, true, show)),
    h('div', { class: 'card' }, h('h3', {}, 'Historial'), actionsTable(all.items.filter((x) => x.status !== 'pending'), true, show)));
}

show();
