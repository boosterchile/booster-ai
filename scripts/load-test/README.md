# Load test — telemetry-tcp-gateway (Wave 2 D1)

Simulador de devices Teltonika FMC150 para validar capacidad del
gateway TCP antes de activar Wave 2 (que aumenta records/min ×10).

## Setup

```bash
pnpm install
```

Las deps del workspace ya están enlazadas — `@booster-ai/codec8-parser`
provee la spec del protocolo.

## Uso rápido — escenarios pre-definidos

```bash
# Baseline: 1 device, validar que CPU < 5%, RAM < 100 MB.
pnpm --filter @booster-ai/load-test start \
  --host telemetry.staging.boosterchile.com --port 5027 \
  --scenario baseline

# Target Wave 2: 10 devices, 1 record/30s, 1 hora.
# Aceptable si CPU < 30%, RAM < 200 MB, p95 latency < 200ms.
pnpm --filter @booster-ai/load-test start \
  --host telemetry.staging.boosterchile.com --port 5027 \
  --scenario target

# Stress: 100 devices, 30 min. Validar que el gateway no caiga ni
# acumule backlog en Pub/Sub > 1000 mensajes. p95 latency < 1s.
pnpm --filter @booster-ai/load-test start \
  --host telemetry.staging.boosterchile.com --port 5027 \
  --scenario stress

# Crash burst: 5 devices simulando Crash Trace simultáneo (~25 KB c/u).
# Confirmar que el gateway publica al topic crash-traces sin matar
# la conexión.
pnpm --filter @booster-ai/load-test start \
  --host telemetry.staging.boosterchile.com --port 5027 \
  --scenario crash-burst
```

## Custom

```bash
pnpm --filter @booster-ai/load-test start \
  --host localhost --port 5027 \
  --devices 5 --rate-sec 60 --duration-sec 300 \
  --scenario custom
```

## Output

JSON con stats agregados a stdout:

```json
{
  "scenario": "target",
  "config": { "host": "...", "port": 5027, "devices": 10, ... },
  "results": {
    "totalPackets": 1200,
    "totalAcks": 1200,
    "totalErrors": 0,
    "ackRatePct": 100,
    "latencyMs": { "p50": 45, "p95": 180, "p99": 245, "max": 320 }
  }
}
```

Exit code:
- `0` — OK.
- `1` — error rate > 1%, OR (scenario stress AND p95 > 1000ms).

## Métricas a capturar EN PARALELO desde Cloud Monitoring

Mientras corre el script, abrir el dashboard "Booster Telemetría —
Overview + Operations" (creado por D5) y screencast los 4 widgets:

1. Records/min by IMEI — debe matchear `devices * (60 / rateSec)`.
2. TCP connection resets — debe ser 0 en baseline/target. > 0 en
   stress es informativo.
3. Parser errors — debe ser 0 (los packets son round-trip válidos).
4. Pub/Sub backlog — < 100 mensajes en target, < 1000 en stress.

Adicional via `kubectl top pod -n telemetry`:
- CPU/RAM por pod del gateway (autoscaling). Anotar peak.

## Documentar resultados

Crear `docs/handoff/2026-05-XX-telemetry-load-test-results.md` con:

```markdown
# Wave 2 Load Test Results — YYYY-MM-DD

## Setup
- Cluster GKE: ...
- Pods replicas: 2 (HPA min)
- ...

## Resultados por escenario

### Baseline (PASS / FAIL)
- JSON output del script.
- CPU peak: X%
- RAM peak: X MB
- ...

(repetir para target, stress, crash-burst)

## Conclusión
- Gate G2.3 (Wave 2 capacity): CLOSED / OPEN
- Si OPEN: lista de gaps + plan de mitigación.
```

## Refs

- Brief: `Booster-FMC150-Wave2-Wave3-Brief-2026-05-06.pdf` — Track D1
  (gate G2.3 — el más crítico de Wave 2)
- Codec 8 spec: https://wiki.teltonika-gps.com/view/Codec
- ADR: `docs/adr/005-telemetry-iot.md`
