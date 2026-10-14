#!/usr/bin/env python3
"""Valida contracts/openapi.yaml (OpenAPI 3.1) y contracts/ai-output.schema.json con casos de aceptación y rechazo.
Requiere: pip install openapi-spec-validator pyyaml jsonschema"""
import json, sys, yaml
from pathlib import Path
from openapi_spec_validator import validate
from jsonschema import Draft202012Validator

root = Path(__file__).resolve().parent.parent
spec = yaml.safe_load((root / "contracts/openapi.yaml").read_text(encoding="utf-8"))
validate(spec)
print(f"PASS  OpenAPI {spec['openapi']} válido, {len(spec['paths'])} rutas")
schema = json.loads((root / "contracts/ai-output.schema.json").read_text(encoding="utf-8"))
Draft202012Validator.check_schema(schema)
v = Draft202012Validator(schema)
rid = "3f2b8c1e-0000-4000-8000-000000000001"
rec = {"requestId": rid, "reason": "r", "evidenceFields": ["prioridad"]}
ok = {"summary": "x", "recommendations": [rec]}
cases = {
    "salida válida": (ok, True),
    "propiedad adicional en la raíz": ({**ok, "x": 1}, False),
    "propiedad adicional en una recomendación": ({"summary": "x", "recommendations": [{**rec, "x": 1}]}, False),
    "evidenceFields con 4 claves": ({"summary": "x", "recommendations": [{**rec, "evidenceFields": ["zona", "prioridad", "fechaRequerida", "observaciones"]}]}, False),
    "evidenceFields vacío": ({"summary": "x", "recommendations": [{**rec, "evidenceFields": []}]}, False),
    "clave de evidencia no permitida": ({"summary": "x", "recommendations": [{**rec, "evidenceFields": ["nombre"]}]}, False),
    "summary de 600 caracteres": ({"summary": "x" * 600, "recommendations": []}, True),
    "summary de 601 caracteres": ({"summary": "x" * 601, "recommendations": []}, False),
    "6 recomendaciones": ({"summary": "x", "recommendations": [rec] * 6}, False),
    "reason de 241 caracteres": ({"summary": "x", "recommendations": [{**rec, "reason": "r" * 241}]}, False),
}
bad = 0
for name, (doc, expected) in cases.items():
    got = not list(v.iter_errors(doc))
    status = "PASS" if got == expected else "FAIL"
    bad += status == "FAIL"
    print(f"{status}  esquema de IA: {name} -> {'aceptada' if got else 'rechazada'}")
print("Nota: el esquema no detecta IDs ajenos ni duplicados; eso lo valida el código del adaptador (ADR-0004).")
sys.exit(1 if bad else 0)
