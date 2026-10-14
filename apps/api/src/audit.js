// Registro append-only. Se llama dentro de la misma transacción que el cambio.
export async function audit(c, { user, type, id, action, from = null, to = null, cid, details = {} }) {
  await c.query(
    `INSERT INTO audit_events (org_id, actor_id, actor_role, resource_type, resource_id, action,
                               from_status, to_status, correlation_id, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [user.orgId, user.id, user.role, type, id, action, from, to, cid, JSON.stringify(details)],
  );
}

export const auditRow = (r) => ({
  id: Number(r.id),
  occurredAt: r.occurred_at,
  actorId: r.actor_id,
  actorRole: r.actor_role,
  resourceType: r.resource_type,
  resourceId: r.resource_id,
  action: r.action,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  correlationId: r.correlation_id,
});
