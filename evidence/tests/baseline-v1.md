# Evidencia baseline-v1
- Fecha UTC: 2026-10-14T05:51:04Z
- Commit base: 6d71593f2fb98af1b7e2759f1673f545b9ad7fa0
- Comando: npm test (apps/api), contra PostgreSQL local sin Docker
- PostgreSQL: PostgreSQL 18.6 on x86_64-windows, compiled by msvc-19.44.35229, 64-bit
- Node: v24.21.0
- Resultado: 6 pasan, 0 fallan (ver baseline-v1-npm-test.txt)
- Nota: PostgreSQL 18, no la imagen 16.4 fijada en Compose; H2-01 a H2-03 siguen abiertos
- Hallazgo abierto: reserve con rol equivocado sobre id de otra organización responde 403 y no 404 (RF02)
