# Spec — Load test TRL 10 (T10-19)

**Programa**: TRL 10 (ADR-082, en revisión en boosterchile/booster-ai#742). Criterio T10-19:

- en un entorno que no es prod, el api sostiene 50 RPS y aguanta un pico de 200, con p95 ≤ 500 ms y p99 ≤ 1,5 s;
- el gateway mantiene 1 000 conexiones TCP concurrentes sin caídas sostenidas;
- el reporte queda en `docs/perf/load-test-YYYY-MM-DD.md`.

**Dependencia**: el entorno no-prod. Lo decide el PO en OQ-1 de `.specs/trl10/spec.md`; la propuesta de staging gemelo está en boosterchile/booster-ai#760. Este PR deja listas las herramientas y el procedimiento. La corrida con evidencia se hace cuando ese entorno exista.

## Entradas

- La URL del api no-prod y un Firebase ID token de un conductor de prueba de ese entorno.
- Host y puerto TCP del gateway no-prod.
- k6 ≥ 0.57 en la máquina que genera carga, que no es Cloud Shell: tiene límites de red.

## Salidas

1. **`apps/api/test/load/t10.k6.js`**:
   - Escenario `sostenido`: 50 RPS de llegada constante durante 10 min.
   - Escenario `pico`: rampa de 50 a 200 RPS en 1 min, mantiene 200 RPS durante 3 min y baja.
   - Mezcla de endpoints, en porcentaje de requests:

     | Endpoint | % |
     |---|---|
     | `/health` | 10 |
     | `/ready` | 10 |
     | `/feature-flags` | 20 |
     | `/me` | 30 |
     | `/me/assignments` | 30 |

   - Umbrales, que son el criterio de T10-19: p95 ≤ 500 ms y p99 ≤ 1 500 ms, globales y por fase; fallos < 1 %; `dropped_iterations` < 50, para que la tasa pedida se haya generado de verdad.
   - El `setup` rechaza `api.boosterchile.com`, que es prod, y valida `/health` y el token antes de generar carga.
2. **`scripts/load-test/telemetry-gateway.ts`**, escenario `t10`:
   - 1 000 devices con rampa de apertura de 120 s, un paquete cada 30 s durante 30 min.
   - Mide el pico de conexiones simultáneas y los devices caídos: cierre o error del server antes de terminar.
   - Falla si el pico es menor que 1 000 o si se cae más del 1 % de los devices.
   - Corrige un cuelgue del simulador: si el server cerraba la conexión sin error, la espera del ack no terminaba nunca.
3. **`docs/perf/load-test-runbook.md`**: procedimiento, métricas paralelas de Cloud Monitoring y plantilla del reporte.

## Desviaciones declaradas

- "Sin caídas sostenidas" se operacionaliza como **≤ 1 % de devices que pierden la conexión** y **pico de 1 000 conexiones simultáneas**. Es el mismo umbral de error del simulador existente. Si el PO quiere 0 caídas, se cambia una constante.
- El tracking público (`/public/tracking/:token`) queda fuera de la mezcla porque tiene rate limit por IP. Medirlo desde un solo generador mediría el limitador.

## Criterios de éxito

- [x] El script k6 compila (`k6 inspect`) y rechaza una `BASE_URL` de prod sin generar tráfico.
- [x] Corrida corta contra el api local (1 min sostenido y 1 min de pico, conductor sembrado en el emulador): umbrales en verde. Valida el script; **no es la evidencia de T10-19**.
- [x] El simulador contra un gateway falso sano da 1 000 conexiones simultáneas, 0 caídas y exit 0.
- [x] El simulador contra un gateway falso que corta 1 de cada 10 conexiones detecta 100 caídas y sale con exit 1.
- [ ] A cargo del PO: el entorno no-prod (OQ-1 / #760), la corrida completa y `docs/perf/load-test-YYYY-MM-DD.md` con resultados.
