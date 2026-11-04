# Runbook — Load test TRL 10 (T10-19)

Criterio (ADR-082, T10-19):

- en un entorno que **no es prod**, el api sostiene 50 RPS y aguanta 200 de pico con p95 ≤ 500 ms y p99 ≤ 1,5 s;
- el gateway mantiene 1 000 conexiones TCP concurrentes sin caídas sostenidas.

El resultado de cada corrida va en `docs/perf/load-test-YYYY-MM-DD.md`, con la plantilla del final. Spec: `.specs/load-test-t10/spec.md`.

## Antes de correr

1. **Entorno no-prod arriba**, según OQ-1 de `.specs/trl10/spec.md` (staging gemelo, boosterchile/booster-ai#760).
   - Las mismas réplicas mínimas, CPU y memoria que prod. Si difieren, se anota en el reporte: el resultado vale para esa configuración.
2. **Un conductor de prueba con viajes** en ese entorno, y su Firebase ID token. El token dura 1 h y la corrida del api dura unos 15 min.
3. **Generador de carga**: una VM o un equipo con k6 ≥ 0.57 y `ulimit -n` ≥ 4096. Cloud Shell no sirve: corta conexiones y limita el ancho de banda.
4. **Aviso al PO**: la corrida genera escrituras de logs y métricas en el entorno no-prod. No toca prod: el script k6 rechaza `api.boosterchile.com`.

## 1. API — 50 RPS sostenidos y 200 de pico

```bash
BASE_URL=https://<api-no-prod> ID_TOKEN=<id-token-conductor> \
  k6 run --summary-export=load-t10-api.json apps/api/test/load/t10.k6.js
```

- Duración: 10 min sostenido + 4,5 min de pico. Se ajusta con `SOSTENIDO_MIN` y `PICO_MIN`.
- k6 termina con código ≠ 0 si falla cualquier umbral: p95, p99, fallos ≥ 1 % o `dropped_iterations` ≥ 50.
- `dropped_iterations` alto significa que **el generador** no alcanzó la tasa. En ese caso se suben `maxVUs` o se cambia de máquina, y se repite. Esa corrida no vale como evidencia.

## 2. Gateway — 1 000 conexiones TCP concurrentes

```bash
pnpm --filter @booster-ai/load-test start \
  --host <gateway-no-prod> --port 5027 --scenario t10 > load-t10-gateway.json
```

- Abre 1 000 devices en una rampa de 120 s. Cada uno manda un paquete AVL cada 30 s durante 30 min.
- Falla (exit 1) si el pico de conexiones simultáneas es menor que 1 000, si se cae más del 1 % de los devices o si los errores superan el 1 %.
- Los IMEI simulados son `356307042000000`–`356307042000999`. Si el entorno exige dispositivos registrados, hay que darlos de alta antes.

## Métricas en paralelo (Cloud Monitoring del entorno)

- **api**: latencia p95 y p99 por ruta, instancias activas, CPU y memoria, conexiones del pool de Postgres, errores 5xx.
- **gateway**: pods y CPU/RAM (`kubectl top pod -n telemetry`), conexiones abiertas, resets TCP, backlog de Pub/Sub de `telemetry-events`.
- **Cloud SQL**: CPU, conexiones y latencia de consultas.

Se capturan los paneles al final de cada fase.

## Plantilla del reporte (`docs/perf/load-test-YYYY-MM-DD.md`)

```markdown
# Load test T10-19 — YYYY-MM-DD

## Entorno
- Proyecto / entorno: …
- api: réplicas min/max, CPU, memoria, versión (commit) …
- gateway: pods, versión …
- Cloud SQL: tier …
- Generador: máquina, región, versión de k6 …

## API (t10.k6.js)
- Sostenido 50 RPS: p95 … ms · p99 … ms · fallos … % · dropped … → PASA / FALLA
- Pico 200 RPS: p95 … ms · p99 … ms · fallos … % · dropped … → PASA / FALLA
- Resumen k6 (`load-t10-api.json`), adjunto o pegado.
- Observaciones: instancias máximas, CPU pico, conexiones a la BD …

## Gateway (escenario t10)
- Pico de conexiones simultáneas: … / 1000
- Devices caídos: … (… %)
- Paquetes / acks / errores: … / … / …
- Latencia de ack p95 / p99: … / … ms
- Backlog de Pub/Sub máximo: …
- → PASA / FALLA

## Conclusión
- T10-19: CUMPLE / NO CUMPLE
- Si no cumple: cuello de botella observado y plan.
```
