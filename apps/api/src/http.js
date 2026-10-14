export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const errorBody = (code, message, correlationId, fields) => ({
  error: { code, message, correlationId, ...(fields ? { fields } : {}) },
});

export const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => typeof s === 'string' && UUID.test(s);

export const ZONES = ['NORTE', 'SUR', 'CENTRO', 'RIBERA'];
export const PRIORITIES = ['NORMAL', 'ALTA'];
export const STATUSES = ['BORRADOR', 'ENVIADA', 'RESERVADA', 'DESPACHADA', 'ENTREGADA', 'CANCELADA'];

// Exige uno de los roles. Si no, 403.
export const allow = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'FORBIDDEN', 'No tiene permiso para esta operación'));

// page y pageSize: pageSize por defecto 20, máximo 100; un valor mayor responde 422 (Q-10).
export function paging(q) {
  const fields = [];
  const num = (v, def, name, max) => {
    if (v === undefined) return def;
    const n = Number(v);
    if (!/^\d+$/.test(String(v)) || n < 1 || (max && n > max)) {
      fields.push({ field: name, message: max ? `debe ser un entero de 1 a ${max}` : 'debe ser un entero >= 1' });
      return def;
    }
    return n;
  };
  const page = num(q.page, 1, 'page');
  const pageSize = num(q.pageSize, 20, 'pageSize', 100);
  if (fields.length) throw new HttpError(422, 'VALIDATION', 'Parámetros de paginación inválidos', fields);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function logEvent(obj) {
  // Logs estructurados en JSON. Nunca se registran cuerpos, cookies ni contraseñas.
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
}
