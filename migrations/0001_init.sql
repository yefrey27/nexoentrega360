-- 0001_init.sql · NexoEntrega 360 · PostgreSQL 16
-- Esquema inicial. Se ejecuta con el rol propietario (nexo_owner o superusuario).
-- El rol de la aplicación (nexo_app) se crea con LOGIN en infra/initdb/01-roles.sh;
-- aquí solo se garantiza que exista para entornos de prueba sin Compose.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexo_app') THEN
    CREATE ROLE nexo_app NOLOGIN;
  END IF;
END
$$;

-- Tipos -------------------------------------------------------------------
CREATE TYPE user_role      AS ENUM ('SOLICITANTE', 'COORDINADOR', 'BODEGA', 'AUDITOR');
CREATE TYPE request_status AS ENUM ('BORRADOR', 'ENVIADA', 'RESERVADA', 'DESPACHADA', 'ENTREGADA', 'CANCELADA');
CREATE TYPE priority_level AS ENUM ('NORMAL', 'ALTA');
CREATE TYPE zone_code      AS ENUM ('NORTE', 'SUR', 'CENTRO', 'RIBERA');

-- Organizaciones y usuarios ----------------------------------------------
CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,10}$'),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  email         text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
  display_name  text NOT NULL,
  role          user_role NOT NULL,
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
CREATE INDEX users_org_idx ON users (org_id);

CREATE TABLE sessions (
  id_hash    text PRIMARY KEY,                 -- hash del identificador de sesión, nunca el valor en claro
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Catálogo e inventario ---------------------------------------------------
CREATE TABLE skus (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code   text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{3,32}$'),
  name   text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE inventory (
  org_id   uuid NOT NULL REFERENCES organizations(id),
  sku_id   uuid NOT NULL REFERENCES skus(id),
  on_hand  integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, sku_id),
  CONSTRAINT inventory_reserved_le_on_hand CHECK (reserved <= on_hand)
);

-- Solicitudes -------------------------------------------------------------
CREATE TABLE org_request_counters (
  org_id uuid PRIMARY KEY REFERENCES organizations(id),
  last_value integer NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);

CREATE TABLE requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  org_id        uuid NOT NULL REFERENCES organizations(id),
  requester_id  uuid NOT NULL,
  zone          zone_code NOT NULL,
  priority      priority_level NOT NULL DEFAULT 'NORMAL',
  required_date date NOT NULL,
  notes         text CHECK (notes IS NULL OR char_length(notes) <= 500),
  status        request_status NOT NULL DEFAULT 'BORRADOR',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  FOREIGN KEY (org_id, requester_id) REFERENCES users (org_id, id),
  UNIQUE (org_id, id)
);
CREATE INDEX requests_org_status_idx   ON requests (org_id, status);
CREATE INDEX requests_org_priority_idx ON requests (org_id, priority);
CREATE INDEX requests_org_zone_idx     ON requests (org_id, zone);
CREATE INDEX requests_org_created_idx  ON requests (org_id, created_at DESC, id);
CREATE INDEX requests_requester_idx    ON requests (org_id, requester_id, created_at DESC);

CREATE TABLE request_lines (
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  sku_id     uuid NOT NULL REFERENCES skus(id),
  quantity   integer NOT NULL CHECK (quantity BETWEEN 1 AND 500),
  PRIMARY KEY (request_id, sku_id)              -- impide SKU repetido
);

-- Defensa en profundidad: transiciones permitidas y 1..10 líneas al enviar
CREATE FUNCTION enforce_request_transition() RETURNS trigger AS $$
DECLARE
  n_lines integer;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
       (OLD.status = 'BORRADOR'   AND NEW.status = 'ENVIADA')
    OR (OLD.status = 'ENVIADA'    AND NEW.status IN ('RESERVADA', 'CANCELADA'))
    OR (OLD.status = 'RESERVADA'  AND NEW.status IN ('DESPACHADA', 'CANCELADA'))
    OR (OLD.status = 'DESPACHADA' AND NEW.status = 'ENTREGADA')
  ) THEN
    RAISE EXCEPTION 'transicion no permitida: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'ENVIADA' THEN
    SELECT count(*) INTO n_lines FROM request_lines WHERE request_id = NEW.id;
    IF n_lines < 1 OR n_lines > 10 THEN
      RAISE EXCEPTION 'una solicitud enviada requiere de 1 a 10 lineas (tiene %)', n_lines
        USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER requests_transition_guard
  BEFORE UPDATE OF status ON requests
  FOR EACH ROW EXECUTE FUNCTION enforce_request_transition();

-- Las líneas solo cambian mientras la solicitud es BORRADOR
CREATE FUNCTION enforce_lines_only_in_draft() RETURNS trigger AS $$
DECLARE
  st request_status;
  rid uuid;
BEGIN
  rid := COALESCE(NEW.request_id, OLD.request_id);
  SELECT status INTO st FROM requests WHERE id = rid;
  IF st IS NOT NULL AND st <> 'BORRADOR' THEN
    RAISE EXCEPTION 'las lineas solo se modifican en BORRADOR (estado %)', st
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER request_lines_draft_guard
  BEFORE INSERT OR UPDATE OR DELETE ON request_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_lines_only_in_draft();

-- Idempotencia ------------------------------------------------------------
CREATE TABLE idempotency_keys (
  org_id          uuid NOT NULL REFERENCES organizations(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  operation       text NOT NULL,
  key             text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash    text NOT NULL,               -- hash del contenido: operación, recurso y cuerpo
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (org_id, user_id, operation, key),
  CHECK (expires_at >= created_at + interval '24 hours')
);
CREATE INDEX idempotency_expires_idx ON idempotency_keys (expires_at);

-- Auditoría append-only ---------------------------------------------------
CREATE TABLE audit_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),   -- UTC
  org_id         uuid NOT NULL REFERENCES organizations(id),
  actor_id       uuid NOT NULL REFERENCES users(id),
  actor_role     user_role NOT NULL,
  resource_type  text NOT NULL,
  resource_id    uuid NOT NULL,
  action         text NOT NULL,
  from_status    request_status,
  to_status      request_status,
  correlation_id text NOT NULL,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_org_time_idx ON audit_events (org_id, occurred_at DESC, id);
CREATE INDEX audit_resource_idx ON audit_events (org_id, resource_type, resource_id, id);

CREATE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events es append-only (% no permitido)', TG_OP
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();

-- Asistente de IA ---------------------------------------------------------
CREATE TABLE ai_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  provider       text NOT NULL CHECK (provider IN ('live', 'local', 'replay', 'fixture', 'none')),
  outcome        text NOT NULL CHECK (outcome IN ('ok', 'invalid_output', 'timeout', 'provider_error')),
  origin         text NOT NULL CHECK (origin IN ('ai', 'fallback')),
  duration_ms    integer NOT NULL CHECK (duration_ms >= 0),
  request_ids    uuid[] NOT NULL CHECK (cardinality(request_ids) BETWEEN 1 AND 20),
  summary        text NOT NULL CHECK (char_length(summary) <= 600),
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  correlation_id text NOT NULL,
  approved_by    uuid REFERENCES users(id),
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);
CREATE INDEX ai_attempts_org_idx ON ai_attempts (org_id, created_at DESC);

-- Migraciones aplicadas (la consulta ready la usa) -------------------------
CREATE TABLE schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (version) VALUES ('0001_init');

-- Permisos del rol de la aplicación ---------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nexo_app;
GRANT USAGE ON SCHEMA public TO nexo_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  sessions, requests, request_lines, inventory, idempotency_keys, org_request_counters
  TO nexo_app;
GRANT SELECT, UPDATE ON ai_attempts TO nexo_app;
GRANT INSERT ON ai_attempts TO nexo_app;
GRANT SELECT ON organizations, users, skus, schema_migrations TO nexo_app;

-- Auditoría: solo lectura e inserción; sin UPDATE, DELETE ni TRUNCATE
GRANT SELECT, INSERT ON audit_events TO nexo_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM nexo_app;

COMMIT;
