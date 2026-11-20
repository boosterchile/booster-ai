# Evidencia matching sombra → decisión (sin flip)

**Fecha**: 2026-11-16 · America/Santiago  
**Alcance**: solo lectura. **No** cambia `MATCHING_ELEGIBILIDAD_MODO` ni `RUTAS_API_ACTIVADA`.  
**Para el PO**: decidir si hay base para pasar matching `sombra` → `activa` (después de rutas).  
**Herramientas**: `scripts/ops/matching-sombra-evidencia.sh`, `scripts/sql/matching-sombra-baseline.sql`.

## Veredicto de esta muestra (2026-11-16)

**No hay comparaciones sombra en prod desde que el flag está en `sombra`.**  
El modo está encendido; el matching no ha vuelto a correr. No hay filas de log
`matching: elegibilidad por carga` ni descriptor de métrica
`workload.googleapis.com/matching_elegibilidad_comparaciones_total` (solo aparece
cuando el contador se exporta al menos una vez).

**Recomendación al PO**: no pasar a `activa` hasta tener ≥ N matching reales en
sombra con el resumen `coincide`/`difiere` a la vista (plantilla abajo). La
línea base de flota/cargas del 2026-11-10 (verify parte 2) sigue siendo el
único contraste disponible; predice que `agricola` sin carrocería perdería
ofertas al activar.

## Cómo se registra la sombra (código)

| Canal | Qué | Dónde |
|---|---|---|
| Log estructurado | `message = "matching: elegibilidad por carga"` | `apps/api/src/services/matching.ts` → `elegibilidadPorCarga` |
| Campos del log | `tripId`, `modo`, `cargoType`, `cargoWeightKg`, `cargoVolumeM3`, `candidatasVigente`, `candidatasPorCarga`, `coinciden`, `soloVigente`, `soloPorCarga`, `vehiculoDistinto`, `volumenInsuficiente` | mismo |
| Error en sombra | `matching: falló la elegibilidad por carga en sombra` — matching vigente **sigue** | mismo (`catch` si `modo !== 'activa'`) |
| Métrica OTel | `matching_elegibilidad_comparaciones_total` labels `modo`, `resultado` ∈ {`coincide`,`difiere`} → Cloud Monitoring como `workload.googleapis.com/…` | `getBusinessCounter` |
| Tablas | **ninguna** — la comparación no se persiste en Postgres | — |
| Quién decide ofertas | en `sombra`/`vigente`: regla de hoy (peso); en `activa`: elegibilidad por carga | `matching.ts` |

`volumenInsuficiente` **avisa** y **no** cuenta como diferencia (`coinciden`
ignora ese campo). Spec: `.specs/matching-desde-la-carga/verify.md` parte 2.

## Muestra recogida (solo lectura, `cursor-agent`)

Proyecto `booster-ai-494222`. Credencial: SA `cursor-agent@…` (roles/viewer +
logging). **Sin** IAP tunnel ni `secretmanager.versions.access` → no hubo SQL
a Cloud SQL en esta pasada.

### Flag en Cloud Run

| Revisión | Creada (UTC) | `MATCHING_ELEGIBILIDAD_MODO` |
|---|---|---|
| `booster-ai-api-00472-wrp` | 2026-11-11T18:46 | `sombra` (primera con el env) |
| `booster-ai-api-00471-9vm` y anteriores | ≤ 2026-11-11T18:04 | ausente (= default código `vigente` si no lo fija Terraform) |
| `booster-ai-api-00476-lts` (100 % prod) | 2026-11-15T20:51 | `sombra` |
| `RUTAS_API_ACTIVADA` | — | no definida (= falsa) |

Terraform: `var.matching_elegibilidad_modo` default `sombra`
(`infrastructure/variables.tf`).

### Matching en logs (30 d)

| Timestamp (UTC) | Evento | tripId (parcial) |
|---|---|---|
| 2026-10-30T16:06 | `matching complete` (1 oferta) | `1b7ec318-…` |
| 2026-10-30T14:09 | `matching produced 0 candidates` | `9a01934b-…` |
| 2026-10-20T13:13 | `matching complete` | `ed6a47b2-…` |
| 2026-10-20T03:23 | `matching complete` | `55399cf9-…` |

- Logs `matching: elegibilidad por carga` (30 d / 90 d): **0**
- Logs con `jsonPayload.modo="sombra"`: **0**
- Logs `matching*` con `timestamp >= 2026-11-13`: **0**
- Descriptores `workload.googleapis.com/*` con `matching`/`elegib`: **0** de 19

### Línea base previa (verify 2026-11-10, no es tráfico sombra)

Flota: 16 activos, sin carrocería, sin arrastres. Viajes: 16 `carga_seca` + 1
`agricola`. Con la regla nueva: `carga_seca` ≈ mismas empresas; `agricola`
→ **cero** candidatas (spec §9). Volumen alto solo avisa.

## Qué debe mirar el PO

1. **Este handoff** — veredicto: sin muestra sombra live.
2. **Orden de flags** (CURRENT): primero `RUTAS_API_ACTIVADA` con ruta punta a
   punta; **después** matching `activa`.
3. **Tras el próximo matching real en prod** (con sombra): correr
   `scripts/ops/matching-sombra-evidencia.sh` y pegar el resumen aquí / en el PR
   de decisión. Criterio sugerido antes de `activa`:
   - ≥ 1 matching con `cargoType` distinto de `carga_seca`/`otra`, **o**
   - ≥ 5 matching con carrocerías ya declaradas en flota, **y**
   - ratio `difiere` entendido (sobre todo `soloVigente` por `agricola` /
     carrocería vacía).
4. **No** activar si la flota sigue sin carrocería y se espera tráfico
   `agricola` u otros tipos que la tabla de compatibilidad excluye.

## Procedimiento exacto (repetible)

```bash
# 1) ADC / SA con logging.viewer (p. ej. cursor-agent)
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/sa.json   # o gcloud auth application-default login
gcloud config set project booster-ai-494222

# 2) Paquete de evidencia (logs + métrica + flag; SQL opcional)
bash scripts/ops/matching-sombra-evidencia.sh --days 30

# 3) Baseline de flota/viajes (requiere IAP + secret database-url o connect.sh)
bash scripts/db/agent-query.sh -f scripts/sql/matching-sombra-baseline.sql
# Si agent-query falla (IAP 403 / sin secret access): usar scripts/db/connect.sh
# como operador humano y pegar el mismo SQL.
```

Filtros Cloud Logging canónicos:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="booster-ai-api"
jsonPayload.message="matching: elegibilidad por carga"
```

```text
jsonPayload.message="matching: falló la elegibilidad por carga en sombra"
```

Métrica (cuando exista el descriptor):

```text
workload.googleapis.com/matching_elegibilidad_comparaciones_total
```

## Plantilla de reporte (pegar tras cada corrida del script)

```markdown
### Corrida YYYY-MM-DD

- Flag Cloud Run: MATCHING_ELEGIBILIDAD_MODO=…
- Ventana: últimos N días
- Matching complete en ventana: …
- Comparaciones sombra (log): total=… coincide=… difiere=… errores=…
- Top soloVigente / soloPorCarga / vehiculoDistinto / volumenInsuficiente: …
- Métrica Cloud Monitoring (si hay descriptor): …
- Baseline SQL (si hubo acceso BD): carrocerías vacías=… / viajes por tipo=…
- Decisión propuesta: mantener sombra | pasar a activa | volver a vigente
- Motivo en 1–2 líneas:
```

### Corrida 2026-11-16 (script contra prod)

```
latestReadyRevision=booster-ai-api-00476-lts
MATCHING_ELEGIBILIDAD_MODO=sombra
RUTAS_API_ACTIVADA=AUSENTE(=falsa)
matching_complete=3
comparaciones_total=0
coincide=0 difiere=0 errores_sombra=0
descriptor=AUSENTE (aún no se exportó el contador en prod)
```

Los 3 `matching complete` son del 2026-10-20/30 (antes de sombra en Cloud Run).

## Límites de esta pasada

| Capacidad | Resultado |
|---|---|
| Cloud Logging / Cloud Run env | OK |
| Cloud Monitoring list descriptors | OK (métrica aún no registrada) |
| SQL prod vía `agent-query.sh` | **Falló**: IAP tunnel `4033 not authorized`; SM `secretmanager.versions.access` denied |
| Flip de flags | **No hecho** (pedido) |

Cuando el PO o un operador con IAP corra el SQL, anexar la salida a este
archivo o a un handoff nuevo con fecha.
