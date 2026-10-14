-- Seed pequeño de NexoEntrega 360 (T-04). Datos ficticios; credenciales solo de demostración.
-- Origen de los hechos: anexo fixture-scenarios.json y acceptance-oracles.md.
-- Contraseña de todas las cuentas de demostración: Nexo-Demo-2026
-- Para regenerar el hash (argon2id):  python -c "from argon2 import PasswordHasher as P; print(P().hash('Nexo-Demo-2026'))"
-- Reinicia el estado: este archivo vacía las tablas de datos y las vuelve a cargar.
-- Debe ejecutarse con el rol propietario (nexo_owner), no con nexo_app.
BEGIN;

-- audit_events es append-only (el disparador bloquea TRUNCATE): se desactiva solo dentro de este seed.
ALTER TABLE audit_events DISABLE TRIGGER USER;
TRUNCATE ai_attempts, idempotency_keys, audit_events, request_lines, requests,
         org_request_counters, sessions, inventory, skus, users, organizations
         RESTART IDENTITY CASCADE;
ALTER TABLE audit_events ENABLE TRIGGER USER;

INSERT INTO organizations (code, name) VALUES
  ('ORG-A', 'Organización comunitaria A (ficticia)'),
  ('ORG-B', 'Organización comunitaria B (ficticia)');

INSERT INTO users (org_id, email, display_name, role, password_hash)
SELECT o.id, lower(o.code) || '-' || lower(r.role) || '@example.test',
       r.role || ' ' || o.code, r.role::user_role, '$argon2id$v=19$m=65536,t=3,p=4$chOoW5R3OiIEuDAl1DSfEg$7Oqfh7uio8UUPjtw6ZxCS3vNuy9niTZdBY1OlwYm46A'
FROM organizations o
CROSS JOIN (VALUES ('SOLICITANTE'), ('COORDINADOR'), ('BODEGA'), ('AUDITOR')) AS r(role);

INSERT INTO skus (code, name) VALUES
  ('KIT-ALIMENTO', 'Kit de alimentos'),
  ('KIT-HIGIENE',  'Kit de higiene'),
  ('KIT-AGUA',     'Kit de agua');

INSERT INTO inventory (org_id, sku_id, on_hand, reserved)
SELECT o.id, s.id, v.on_hand, 0
FROM (VALUES
  ('ORG-A','KIT-ALIMENTO',10), ('ORG-A','KIT-HIGIENE',8), ('ORG-A','KIT-AGUA',20),
  ('ORG-B','KIT-ALIMENTO',4),  ('ORG-B','KIT-HIGIENE',5), ('ORG-B','KIT-AGUA',6)
) AS v(org, sku, on_hand)
JOIN organizations o ON o.code = v.org
JOIN skus s ON s.code = v.sku;

-- Solicitudes del anexo. Se crean en BORRADOR, se les añaden las líneas y luego pasan a ENVIADA
-- por UPDATE, porque los disparadores solo permiten líneas en BORRADOR.
INSERT INTO requests (code, org_id, requester_id, zone, priority, required_date, notes)
SELECT v.code, o.id, u.id, v.zone::zone_code, v.prio::priority_level, v.fecha::date, v.notes
FROM (VALUES
  ('A-001','ORG-A','org-a-solicitante@example.test','NORTE','ALTA',  '2030-01-11','Entrega comunitaria programada.'),
  ('A-002','ORG-A','org-a-solicitante@example.test','SUR',  'NORMAL','2030-01-12','Solicitud pendiente.'),
  ('B-001','ORG-B','org-b-solicitante@example.test','CENTRO','ALTA',  '2030-01-11','Dato exclusivo de ORG-B.')
) AS v(code, org, login, zone, prio, fecha, notes)
JOIN organizations o ON o.code = v.org
JOIN users u ON u.email = v.login;

INSERT INTO request_lines (request_id, sku_id, quantity)
SELECT r.id, s.id, v.qty
FROM (VALUES ('A-001','KIT-ALIMENTO',7), ('A-002','KIT-ALIMENTO',7), ('B-001','KIT-HIGIENE',2)) AS v(code, sku, qty)
JOIN requests r ON r.code = v.code
JOIN skus s ON s.code = v.sku;

UPDATE requests SET status = 'ENVIADA', submitted_at = now() WHERE code IN ('A-001','A-002','B-001');

COMMIT;
