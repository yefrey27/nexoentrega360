#!/usr/bin/env bash
# Prueba T-01: aplica migrations/*.sql sobre una base limpia de PostgreSQL y comprueba
# restricciones, disparadores, permisos del rol nexo_app y el patrón atómico de reserva.
# Uso: PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres scripts/test_migration.sh [archivo_salida]
# Requiere un usuario con CREATEDB y CREATEROLE. No toca otras bases.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-}"
DB="nexo_t01_$$"
PASS=0
FAIL=0

admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
owner() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
app()   { PGUSER=nexo_app psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

report() {
  if [ "$1" = ok ]; then PASS=$((PASS+1)); echo "PASS  $2"; else FAIL=$((FAIL+1)); echo "FAIL  $2 -> $3"; fi
}

# expect_fail <nombre> <sqlstate esperado> <patrón de mensaje o -> <owner|app> <sql>
expect_fail() {
  local name="$1" state="$2" pat="$3" who="$4" sql="$5" out
  out=$($who -At -c "DO \$\$ DECLARE s text := 'none'; m text := ''; BEGIN
      BEGIN $sql; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE, m = MESSAGE_TEXT; END;
      IF s <> '$state' THEN RAISE EXCEPTION 'esperado $state, obtenido % (%)', s, m; END IF;
      IF '$pat' <> '-' AND m NOT ILIKE '%$pat%' THEN RAISE EXCEPTION 'mensaje sin patron $pat: %', m; END IF;
    END \$\$;" 2>&1)
  if [ $? -eq 0 ]; then report ok "$name (SQLSTATE $state)"; else report bad "$name" "$out"; fi
}

# expect_ok <nombre> <owner|app> <sql>
expect_ok() {
  local out
  out=$($2 -At -c "$3" 2>&1)
  if [ $? -eq 0 ]; then report ok "$1"; else report bad "$1" "$out"; fi
}

# expect_val <nombre> <esperado> <owner|app> <sql>
expect_val() {
  local got
  got=$($3 -At -c "$4" 2>&1)
  if [ "$got" = "$2" ]; then report ok "$1 = $2"; else report bad "$1" "esperado '$2', obtenido '$got'"; fi
}

run() {
echo "T-01 Migración y restricciones"
echo "Fecha UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Commit: $(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo sin-commit)"
echo "Servidor: $(admin -At -c 'select version()')"
echo "Comando: scripts/test_migration.sh"
echo "Base temporal: $DB"
echo "-----"

admin -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" || { echo "no se pudo crear la base"; exit 2; }
admin -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nexo_app') THEN CREATE ROLE nexo_app LOGIN; END IF; END \$\$;" -c "ALTER ROLE nexo_app LOGIN" >/dev/null
admin -c "GRANT CONNECT ON DATABASE $DB TO nexo_app" >/dev/null

# 1. Migraciones en orden
for f in "$ROOT"/migrations/*.sql; do
  if owner -f "$f" >/dev/null 2>/tmp/mig_err_$$; then report ok "migración $(basename "$f") aplicada"; else report bad "migración $(basename "$f")" "$(cat /tmp/mig_err_$$)"; fi
done
expect_val "schema_migrations registra 0001_init" "1" owner "select count(*) from schema_migrations where version='0001_init'"

# 2. Datos de prueba (oráculo escrito de antemano: física 10, reservada 0, A-001 y A-002 piden 7)
owner >/dev/null <<'SQL'
INSERT INTO organizations (id, code, name) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','ORGA','Organizacion A'),
 ('bbbbbbbb-0000-0000-0000-000000000002','ORGB','Organizacion B');
INSERT INTO users (id, org_id, email, display_name, role, password_hash) VALUES
 ('a1000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','sol.a@ejemplo.test','Sol A','SOLICITANTE','$argon2id$fixture'),
 ('a2000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','coord.a@ejemplo.test','Coord A','COORDINADOR','$argon2id$fixture'),
 ('b1000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','sol.b@ejemplo.test','Sol B','SOLICITANTE','$argon2id$fixture');
INSERT INTO skus (id, code, name) SELECT ('5c000000-0000-0000-0000-0000000000'||lpad(i::text,2,'0'))::uuid, 'KIT-'||lpad(i::text,3,'0'), 'Kit '||i FROM generate_series(1,12) i;
INSERT INTO inventory (org_id, sku_id, on_hand, reserved) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','5c000000-0000-0000-0000-000000000001',10,0);
INSERT INTO requests (id, code, org_id, requester_id, zone, priority, required_date, status) VALUES
 ('11111111-0000-0000-0000-00000000a001','SOL-ORGA-000001','aaaaaaaa-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','NORTE','NORMAL',current_date+1,'BORRADOR'),
 ('11111111-0000-0000-0000-00000000a002','SOL-ORGA-000002','aaaaaaaa-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','SUR','ALTA',current_date+1,'BORRADOR');
INSERT INTO request_lines VALUES
 ('11111111-0000-0000-0000-00000000a001','5c000000-0000-0000-0000-000000000001',7),
 ('11111111-0000-0000-0000-00000000a002','5c000000-0000-0000-0000-000000000001',7);
UPDATE requests SET status='ENVIADA' WHERE id in ('11111111-0000-0000-0000-00000000a001','11111111-0000-0000-0000-00000000a002');
SQL
report ok "datos de prueba cargados (A-001 y A-002 ENVIADA, 7 unidades cada una, física 10)"

# 3. Restricciones de inventario (RF05, C-03)
OA="'aaaaaaaa-0000-0000-0000-000000000001'"; S1="'5c000000-0000-0000-0000-000000000001'"; S2="'5c000000-0000-0000-0000-000000000002'"
expect_fail "inventario: reservada mayor que física" 23514 - owner "UPDATE inventory SET reserved = 11 WHERE org_id=$OA AND sku_id=$S1"
expect_fail "inventario: física negativa" 23514 - owner "UPDATE inventory SET on_hand = -1 WHERE org_id=$OA AND sku_id=$S1"
expect_fail "inventario: reservada negativa" 23514 - owner "UPDATE inventory SET reserved = -1 WHERE org_id=$OA AND sku_id=$S1"
expect_val "inventario sin cambios tras los rechazos" "10|0" owner "select on_hand||'|'||reserved from inventory where org_id=$OA and sku_id=$S1"

# 4. Líneas (RF03)
RQ="'11111111-0000-0000-0000-00000000a003'"
owner -c "INSERT INTO requests (id, code, org_id, requester_id, zone, required_date) VALUES ($RQ,'SOL-ORGA-000003',$OA,'a1000000-0000-0000-0000-000000000001','CENTRO',current_date)" >/dev/null
expect_fail "línea con cantidad 0" 23514 - owner "INSERT INTO request_lines VALUES ($RQ,$S1,0)"
expect_fail "línea con cantidad 501" 23514 - owner "INSERT INTO request_lines VALUES ($RQ,$S1,501)"
expect_fail "línea con cantidad negativa" 23514 - owner "INSERT INTO request_lines VALUES ($RQ,$S1,-5)"
owner -c "INSERT INTO request_lines VALUES ($RQ,$S1,1)" >/dev/null
expect_fail "SKU repetido en la misma solicitud" 23505 - owner "INSERT INTO request_lines VALUES ($RQ,$S1,2)"
expect_fail "SKU inexistente" 23503 - owner "INSERT INTO request_lines VALUES ($RQ,'5c000000-0000-0000-0000-0000000000ff',2)"
expect_fail "observaciones de 501 caracteres" 23514 - owner "UPDATE requests SET notes = repeat('x',501) WHERE id=$RQ"
expect_ok "observaciones de 500 caracteres" owner "UPDATE requests SET notes = repeat('x',500) WHERE id=$RQ"
expect_fail "solicitante de otra organización (FK compuesta)" 23503 - owner "INSERT INTO requests (code, org_id, requester_id, zone, required_date) VALUES ('SOL-ORGA-000099',$OA,'b1000000-0000-0000-0000-000000000001','SUR',current_date)"
expect_fail "código de solicitud duplicado" 23505 - owner "INSERT INTO requests (code, org_id, requester_id, zone, required_date) VALUES ('SOL-ORGA-000001',$OA,'a1000000-0000-0000-0000-000000000001','SUR',current_date)"

# 5. Transiciones (RF04)
RB="'11111111-0000-0000-0000-00000000a004'"
owner -c "INSERT INTO requests (id, code, org_id, requester_id, zone, required_date) VALUES ($RB,'SOL-ORGA-000004',$OA,'a1000000-0000-0000-0000-000000000001','RIBERA',current_date)" >/dev/null
expect_fail "enviar borrador sin líneas" 23514 "1 a 10" owner "UPDATE requests SET status='ENVIADA' WHERE id=$RB"
for i in $(seq 1 11); do owner -c "INSERT INTO request_lines VALUES ($RB,('5c000000-0000-0000-0000-0000000000'||lpad($i::text,2,'0'))::uuid,1)" >/dev/null; done
expect_fail "enviar borrador con 11 líneas" 23514 "1 a 10" owner "UPDATE requests SET status='ENVIADA' WHERE id=$RB"
owner -c "DELETE FROM request_lines WHERE request_id=$RB AND sku_id=('5c000000-0000-0000-0000-0000000000'||lpad('11',2,'0'))::uuid" >/dev/null
expect_ok "enviar borrador con 10 líneas" owner "UPDATE requests SET status='ENVIADA' WHERE id=$RB"
expect_fail "BORRADOR a RESERVADA" 23514 "no permitida" owner "UPDATE requests SET status='RESERVADA' WHERE id=$RQ"
expect_fail "ENVIADA a DESPACHADA" 23514 "no permitida" owner "UPDATE requests SET status='DESPACHADA' WHERE id=$RB"
expect_fail "ENVIADA a ENTREGADA" 23514 "no permitida" owner "UPDATE requests SET status='ENTREGADA' WHERE id=$RB"
expect_fail "modificar líneas de una solicitud ENVIADA" 23514 "solo se modifican" owner "UPDATE request_lines SET quantity=2 WHERE request_id=$RB AND sku_id=$S1"
expect_fail "borrar líneas de una solicitud ENVIADA" 23514 "solo se modifican" owner "DELETE FROM request_lines WHERE request_id=$RB"
owner -c "UPDATE requests SET status='RESERVADA' WHERE id=$RB; UPDATE requests SET status='DESPACHADA' WHERE id=$RB; UPDATE requests SET status='ENTREGADA' WHERE id=$RB" >/dev/null
expect_val "cadena completa BORRADOR a ENTREGADA" "ENTREGADA" owner "select status from requests where id=$RB"
expect_fail "ENTREGADA a CANCELADA" 23514 "no permitida" owner "UPDATE requests SET status='CANCELADA' WHERE id=$RB"
expect_fail "ENTREGADA a ENVIADA" 23514 "no permitida" owner "UPDATE requests SET status='ENVIADA' WHERE id=$RB"

# 6. Auditoría append-only (RF09, C-07)
EV="INSERT INTO audit_events (org_id, actor_id, actor_role, resource_type, resource_id, action, from_status, to_status, correlation_id) VALUES ($OA,'a2000000-0000-0000-0000-000000000002','COORDINADOR','request',$RB,'RESERVAR','ENVIADA','RESERVADA','corr-test-1')"
expect_ok "nexo_app inserta evento de auditoría" app "$EV"
expect_ok "nexo_app lee auditoría" app "select count(*) from audit_events"
expect_fail "nexo_app: UPDATE sobre audit_events denegado" 42501 "permission denied" app "UPDATE audit_events SET action='X'"
expect_fail "nexo_app: DELETE sobre audit_events denegado" 42501 "permission denied" app "DELETE FROM audit_events"
expect_fail "nexo_app: TRUNCATE sobre audit_events denegado" 42501 "permission denied" app "TRUNCATE audit_events"
expect_fail "propietario: UPDATE bloqueado por disparador" 42501 "append-only" owner "UPDATE audit_events SET action='X'"
expect_fail "propietario: DELETE bloqueado por disparador" 42501 "append-only" owner "DELETE FROM audit_events"
expect_fail "propietario: TRUNCATE bloqueado por disparador" 42501 "append-only" owner "TRUNCATE audit_events"
expect_val "auditoría conserva 1 evento" "1" owner "select count(*) from audit_events"
expect_fail "nexo_app: no modifica usuarios" 42501 "permission denied" app "UPDATE users SET role='AUDITOR'"
expect_fail "nexo_app: no crea tablas" 42501 "permission denied" app "CREATE TABLE intruso (id int)"

# 7. Idempotencia (RF07)
IK="INSERT INTO idempotency_keys (org_id,user_id,operation,key,request_hash) VALUES ($OA,'a2000000-0000-0000-0000-000000000002','RESERVAR','clave-123456','h1')"
expect_ok "inserta clave de idempotencia" app "$IK"
expect_fail "misma clave, usuario, organización y operación" 23505 - app "$IK"
expect_ok "misma clave en otra operación es independiente" app "INSERT INTO idempotency_keys (org_id,user_id,operation,key,request_hash) VALUES ($OA,'a2000000-0000-0000-0000-000000000002','CANCELAR','clave-123456','h2')"
expect_fail "retención menor a 24 horas" 23514 - app "INSERT INTO idempotency_keys (org_id,user_id,operation,key,request_hash,expires_at) VALUES ($OA,'a2000000-0000-0000-0000-000000000002','RESERVAR','clave-corta-1','h3', now()+interval '1 hour')"
expect_fail "clave de menos de 8 caracteres" 23514 - app "INSERT INTO idempotency_keys (org_id,user_id,operation,key,request_hash) VALUES ($OA,'a2000000-0000-0000-0000-000000000002','RESERVAR','corta','h4')"

# 8. IA: restricciones
expect_fail "intento de IA con 21 identificadores" 23514 - app "INSERT INTO ai_attempts (org_id,user_id,provider,outcome,origin,duration_ms,request_ids,summary,correlation_id) VALUES ($OA,'a2000000-0000-0000-0000-000000000002','fixture','ok','ai',5,(select array_agg(gen_random_uuid()) from generate_series(1,21)),'s','c')"
expect_fail "intento de IA con resumen de 601 caracteres" 23514 - app "INSERT INTO ai_attempts (org_id,user_id,provider,outcome,origin,duration_ms,request_ids,summary,correlation_id) VALUES ($OA,'a2000000-0000-0000-0000-000000000002','fixture','ok','ai',5,array[gen_random_uuid()],repeat('x',601),'c')"
expect_fail "proveedor de IA desconocido" 23514 - app "INSERT INTO ai_attempts (org_id,user_id,provider,outcome,origin,duration_ms,request_ids,summary,correlation_id) VALUES ($OA,'a2000000-0000-0000-0000-000000000002','openai-x','ok','ai',5,array[gen_random_uuid()],'s','c')"

# 9. Reserva atómica concurrente a nivel SQL (patrón del ADR-0002): A-001 contra A-002
cat > /tmp/reserve_$$.sql <<'SQL'
BEGIN;
-- bloquea la fila de inventario, comprueba disponibilidad y reserva; la espera simula carga
SELECT on_hand, reserved FROM inventory WHERE org_id='aaaaaaaa-0000-0000-0000-000000000001' AND sku_id='5c000000-0000-0000-0000-000000000001' FOR UPDATE;
SELECT pg_sleep(1);
WITH u AS (
  UPDATE inventory SET reserved = reserved + 7
  WHERE org_id='aaaaaaaa-0000-0000-0000-000000000001' AND sku_id='5c000000-0000-0000-0000-000000000001'
    AND on_hand - reserved >= 7
  RETURNING 1)
SELECT 'FILAS=' || count(*) FROM u;
COMMIT;
SQL
owner -c "UPDATE inventory SET reserved=0 WHERE org_id=$OA AND sku_id=$S1" >/dev/null
(owner -At -f /tmp/reserve_$$.sql 2>&1 | grep 'FILAS=' > /tmp/r1_$$.txt) &
(owner -At -f /tmp/reserve_$$.sql 2>&1 | grep 'FILAS=' > /tmp/r2_$$.txt) &
wait
exitosas=$(cat /tmp/r1_$$.txt /tmp/r2_$$.txt | grep -c 'FILAS=1')
rechazadas=$(cat /tmp/r1_$$.txt /tmp/r2_$$.txt | grep -c 'FILAS=0')
if [ "$exitosas" = 1 ] && [ "$rechazadas" = 1 ]; then report ok "concurrencia A-001 contra A-002: 1 éxito y 1 rechazo"; else report bad "concurrencia" "éxitos=$exitosas rechazos=$rechazadas"; fi
expect_val "concurrencia: física|reservada|disponible persistidas" "10|7|3" owner "select on_hand||'|'||reserved||'|'||(on_hand-reserved) from inventory where org_id=$OA and sku_id=$S1"

echo "-----"
echo "Resultado: $PASS aprobadas, $FAIL fallidas"
admin -c "DROP DATABASE IF EXISTS $DB" >/dev/null
rm -f /tmp/reserve_$$.sql /tmp/r1_$$.txt /tmp/r2_$$.txt /tmp/mig_err_$$
[ "$FAIL" -eq 0 ]
}

if [ -n "$OUT" ]; then run 2>&1 | tee "$OUT"; exit "${PIPESTATUS[0]}"; else run; fi
