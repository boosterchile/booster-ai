# Frentes vivos y criterios de término

**Ubicación sugerida en el repo:** `docs/frentes-vivos.md`
**Estado verificado contra:** `main` @ `3d3c753` + las ramas feature listadas en el Slot 1 (2026-08-17)
**Autor de la verificación:** revisión sobre clon de `main` y sobre cada rama; los estados marcados ✅/❌ salen de existencia de archivo o de símbolo, no de inferencia. **Convención:** ✅ `main` = está en `main`; ✅ rama = implementado, testeado y pusheado en la rama indicada, **sin PR ni merge** (no está en prod).

---

## Regla de operación

1. **Máximo tres frentes vivos.** Todo lo demás está congelado por escrito, no de facto.
2. **Ningún frente entra sin criterio de término escrito.** Si el criterio no se puede formular en términos observables y verificables por un tercero, el trabajo está en exploración y la exploración no ocupa slot.
3. **Un frente sale de la lista solo cumpliendo su criterio**, no por pérdida de interés ni por aparición de otro más urgente.
4. **Se cierra lo que más libera**, no lo más avanzado.
5. **Vocabulario de término, no de progresión.** Prohibido nombrar trabajo nuevo como `Ola N`, `Capa N`, `Fase N`, `WN` o `paso N` sin que exista, en el mismo documento, la condición que declara terminada esa serie.

---

## Slot 1 — Huella de carbono punta a punta

**Por qué es el primero:** es el corazón del producto y su atributo comercial. Todo el trabajo de telemetría existe para alimentarlo. Está bloqueado por cuatro tareas, tres de ellas pequeñas.

**Terminado cuando:** dos viajes reales en producción —uno con vehículo FMC150 y otro sin él— cierran con `carbonEmissionsKgco2eActual` poblado, o con degradación explícita registrada (`*Actual = null` + métrica data-quality + certificación degradada). Nunca `0`, nunca fallo silencioso.

**Verificación:**

```sql
SELECT id, distance_km_actual, carbon_emissions_kgco2e_actual, coverage_pct
FROM viajes
WHERE picked_up_at IS NOT NULL AND delivered_at IS NOT NULL
ORDER BY delivered_at DESC LIMIT 10;
```

Un viaje con Teltonika y uno sin él, ambos con valor o con degradación registrada.

**Fuera de alcance (no se hace bajo este frente):** F3 (ETA bifásico), F4 (hitos consignee), alertas sobre señales, dashboards de huella, exportación a stakeholders ESG. Cualquiera de esos entra como frente nuevo y compite por slot.

**Estado verificado de F1+F2** (`.specs/medicion-huella-segmento/plan.md`, 50 checkboxes; 21 marcados repartidos en las ramas — T1/T6/T7 se hicieron antes de que el plan llevara checkboxes y siguen en `[ ]`):

| Tarea | Artefacto | Estado |
|---|---|---|
| T1 | columnas opt-in en `empresas` + `trips` | ✅ `main` (`schema.ts`, migración `0046`) |
| T2 | `trips.origin_latitude/longitude` | ✅ rama `feat/columnas-origen-latlng` @ `0826587` — migración `0054` + `down/`, tests unit + integration |
| T3 | `services/resolver-opt-in-huella.ts` | ✅ rama `feat/resolver-opt-in-huella` @ `b7b3145` — 7 casos |
| T4 | `services/geocodificar-origen.ts` | ✅ rama `feat/geocodificar-origen` @ `f682652` (apilada sobre T2) — `computeRoutes` expone `startLocation`; wire en `POST /trip-requests-v2`; degrada a NULL con métrica `viaje_origen_geocodificacion_total` |
| T5 | guard `esConfirmableRecogida` | ✅ rama `feat/guard-es-confirmable-recogida` @ `31b232b` |
| T6 | `services/confirmar-recogida-viaje.ts` | ✅ `main`; en T9 gana `pickedUpAt?` opcional acotado (≤ now + 2 min, ≥ `acceptedAt`) |
| T7 | `PATCH /:id/confirmar-recogida` | ✅ `main` (`assignments.ts:437`) **sin el body `picked_up_at` que decía el plan**; completado en la rama de T9 |
| T8 | `services/geofence-origen.ts` + `GEOFENCE_RADIUS_M` | ✅ rama `feat/geofence-origen` @ `ffa9fe3` — la env var vive en `apps/api/src/config.ts` (el `packages/config/src/env.ts` del plan no existe) |
| T9 | disparo en `conductor.tsx` | ✅ rama `feat/recogida-geofence-web` @ `f4bc7fd` (apilada sobre T2+T4, con merge de T8) — `POST /driver-position` responde `geofence`; hook `use-confirmar-recogida`; sugerencia + tap; `picked_up_at` = instante del cruce |
| T10 | `services/posicion-segmento.ts` | ❌ — **este es el fallback sin FMC150**; bloqueado por la decisión GLEC de abajo |
| T11–13 | cobertura, huella real, wire post-entrega | archivos existen; modificaciones pendientes |

**Ramas sin mergear (0 PRs abiertos al 2026-08-17)** — orden de merge sugerido: `feat/resolver-opt-in-huella` · `feat/guard-es-confirmable-recogida` · `feat/geofence-origen` (independientes, salen de `main`) → `feat/columnas-origen-latlng` → `feat/geocodificar-origen` → `feat/recogida-geofence-web`. Alternativa: `feat/recogida-geofence-web` ya contiene T2+T4+T8+T9 y puede ir como un solo PR "F1 geofence" contra `main`. **Mientras no mergeen, prod sigue sin nada de F1 nuevo.**

**Orden de ejecución** (respeta la compuerta dura: F1 completo antes de F2):

1. ~~**T3**~~ ✅ rama — función pura, sin dependencias de DB, siete casos de test. Es la que decide si un viaje mide huella; sin ella nada del resto se activa.
2. ~~**T5**~~ ✅ rama — guard derivado de la tabla de transiciones. T6 y T7 se construyeron saltándose esta dependencia; cerrarla es alinear el handler con la máquina de estados.
3. ~~**T2** → **T4** → **T8**~~ ✅ ramas — cadena del geofence: columnas, geocodificación del origen vía Routes API, detector por haversine. T4 degrada sin bloquear la creación del viaje (verificado: 7 escenarios de degradación con métrica).
4. ~~**T9**~~ ✅ rama — disparo híbrido (sugerencia por geofence + tap). Dos contratos del API que el plan no fijaba, aprobados por el PO el 2026-08-17: `POST /assignments/:id/driver-position` devuelve `geofence: {estado, distancia_m}` evaluado en servidor; `PATCH /assignments/:id/confirmar-recogida` acepta `{ picked_up_at }` opcional acotado en `confirmarRecogidaViaje` (`400 invalid_picked_up_at` fuera de cotas; el evento registra `picked_up_at_source: cliente|servidor`).
5. **F1 cerrado en ramas; cierra de verdad al mergear.** Recién entonces **T10**, el enrutamiento de fuente de posición: con Teltonika → `telemetria_puntos`; sin Teltonika → `posiciones_movil_conductor`. Sin merge de streams.
6. **T11–13** — cobertura anclada al pickup real, umbral binario ~80%, degradación por peso ausente.

**Decisión pendiente que hay que tomar antes de T10:** la huella calculada desde CAN sale de combustible real; la calculada desde posición del móvil sale de un modelo de estimación. No son el mismo producto. Definir por escrito qué nivel de certificación GLEC corresponde a cada fuente y cómo se rotula al cliente. Sin esta decisión, T10 produce un número cuya validez comercial no está definida.

---

## Slot 2 — Limpieza de la superficie demo

**Por qué:** la bandera `es_demo` atraviesa el núcleo de autenticación y autorización. Mientras exista, cada cambio en ese núcleo carga una dimensión adicional.

**Terminado cuando:** `grep -rl 'es_demo\|isDemo\|DEMO_\|demo\.boosterchile'` sobre `apps/`, `packages/` e `infrastructure/` devuelve cero archivos, y `demo.boosterchile.com` no tiene registro DNS ni recurso en Terraform.

**Estado verificado:** 40 archivos (ya excluida la superficie de impersonación, desacoplada por ADR-053).

Núcleo — lo que hay que desmontar primero porque es lo que contamina:

- `apps/api/src/middleware/is-demo-enforcement.ts` (+ test)
- `apps/api/src/middleware/demo-expires.ts` (+ test)
- `apps/api/src/middleware/firebase-auth.ts`
- `apps/api/src/services/cuentas-demo.ts`
- `apps/api/src/services/harden-demo-accounts.ts` (+ test)
- `apps/api/src/services/sse-ticket.ts` (+ test)
- `apps/api/src/{server,config}.ts`, `apps/api/src/db/schema.ts`
- `apps/api/src/routes/{feature-flags,admin-signup-requests,chat}.ts`

Verificación en CI — ya existen dos scripts que se pueden invertir de "verifica el cableado demo" a "verifica que no queda demo":

- `apps/api/scripts/check-is-demo-wire-completeness.ts`
- `apps/api/scripts/check-route-default-deny.ts`

Frontend: `ProtectedRoute.tsx`, `DemoBanner.tsx`, `hooks/use-is-demo.ts`, rutas `index`, `login`, `maintenance`, `platform-admin-site-settings`.
Terraform: `variables.tf`, `compute.tf`, `networking.tf`, `security-hotfixes-2026-05-14.tf`, `identity-platform.tf`.
Contratos: `packages/shared-schemas/src/site-settings.ts`.

**Fuera de alcance:** cualquier reintroducción de un modo demo. La necesidad legítima que cubría —operar como una empresa de prueba— queda resuelta por impersonación sobre `empresas.es_usuario_prueba` (migración `0050`), que usa el flujo real y no requiere código dedicado.

---

## Slot 3 — Cierre documental de SEC-001

**Por qué:** el trabajo está terminado en producción, pero el rastro documental sigue leyéndose como decisión pendiente. Es el frente más barato de cerrar y el que más ruido quita.

**Hecho verificado:** `.specs/sec-001-h1-2-google-boundary-closure/spec.md` está en `Status: Shipped (2026-06-05)`, código en producción (canary → 100%), `terraform apply` aplicado, **SC-1.2.2 Google leg = MET**.

**Terminado cuando** cada uno de estos documentos declara su estado terminal en el encabezado y ninguno queda en `Draft` o `Proposed` sin nota de resolución:

- `.specs/sec-001-h1-2-google-blocking/` (umbrella + `spec-v1` + `plan-v1/v2/v3` + `plan-review`) → **Superado por `boundary-closure`**
- `.specs/sec-001-h1-2-google-blocking-a/` → **Entregado; superado en la superficie Gen 2**
- `.specs/sec-001-h1-2-google-blocking-b/` → **Abandonado en T8; superado**
- `.specs/sec-001-h1-2-google-blocking-c/` → ya marcado `SUPERSEDED`; sin cambios
- `docs/adr/054-...` → **No perseguido.** La migración a Gen 2 fue descartada a favor de la Alternativa G. No requiere enmienda.
- `.specs/sec-001-cierre/plan-sprint-2a.md` y `plan-sprint-2b.md` → estado terminal

**Único trabajo técnico residual:** el modo destructivo del reaper (`REAPER_DESTRUCTIVE=true`) queda tras el gate de primer run destructivo, hoy en pausa con dry-run validado (14 escaneadas, 0 tocadas). **No es parte de este slot.** Entra como frente nuevo cuando se decida ejecutarlo.

---

## Congelados

No se trabaja en ellos hasta que un slot se libere. Cada uno tiene condición explícita de descongelamiento.

**Sistema de diseño D1/D2.** Las primitivas existentes se usan donde ya están; no se agregan primitivas, tokens, acentos ni olas nuevas. Descongela cuando el Slot 1 cierre, y entra con criterio de cobertura sobre una lista cerrada de pantallas —nunca sobre número de primitivas—.

**Onboarding / alta de empresas.** Congelado como frente de construcción. La necesidad operativa (probar con empresas ficticias) se cubre hoy con impersonación sobre `es_usuario_prueba`. Descongela solo si esa vía resulta insuficiente en uso real, y en ese caso el criterio es: una empresa de prueba se crea por el flujo estándar, opera de punta a punta y no aparece en ningún reporte ni cobro.

**Certificados PDF.** Criterio a escribir cuando descongele, con esta forma: el PDF de \<tipo\> con \<campos\> se genera y valida contra el formato exigido por \<quién lo recibe\>.

**Infraestructura y observabilidad.** No termina, se convierte en operación. Criterio a escribir con esta forma: existe alerta accionable para \<lista cerrada de fallas\>, con runbook asociado.

**Despacho / conductor.** Criterio a escribir con esta forma: un viaje pasa de creado a cerrado en producción sin intervención manual del PO.

---

## Deuda de documentación (no es frente; se corrige al pasar)

`README.md` está desactualizado y es la cara pública del repo: dice Node 22 (es 24), pnpm 9 (es 10), lista `agent-rigor` como parte del stack (descontinuado por ADR-072), dice "ADRs 001..050" (van 074), y escribe "FMS150" donde el equipo es **FMC150**.
