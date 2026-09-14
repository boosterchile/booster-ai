# Frentes vivos y criterios de término

**Ubicación sugerida en el repo:** `docs/frentes-vivos.md`
**Estado verificado contra:** `main` @ `623ee2b` (2026-08-16)
**Autor de la verificación:** revisión sobre clon de `main`; los estados marcados ✅/❌ salen de existencia de archivo o de símbolo, no de inferencia.
**Actualización 2026-09-13** (`main` @ `7e99dc0`): Slot 3 cerrado y reemplazado por «Conductor operativo» (decisión D2 del PO); Slot 1 con F1 cerrado. El conteo del Slot 2 no se re-verificó en esta pasada.

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

**Estado de F1+F2:** la fuente es `.specs/medicion-huella-segmento/plan.md` (checkboxes). No se duplica aquí.

**Avance 2026-09-13:** T1–T10 y la migración 0055 (`movil_gps` coherente en enum de BD, shared-schemas, carbon-calculator y certificate-generator, ADR-077) están en `main` (#658–#664, #672, #663). La compuerta F1 está cerrada; lo siguiente es T11. El criterio de término exige además cerrar entregas reales en producción, que hoy dependen del gate documental (ver Slot 3, paso 1).

**Orden de ejecución** (respeta la compuerta dura: F1 completo antes de F2):

1. **T3** — función pura, sin dependencias de DB, siete casos de test. Es la que decide si un viaje mide huella; sin ella nada del resto se activa.
2. **T5** — guard derivado de la tabla de transiciones. T6 y T7 se construyeron saltándose esta dependencia; cerrarla es alinear el handler con la máquina de estados.
3. **T2** → **T4** → **T8** — cadena del geofence: columnas, geocodificación del origen vía Routes API, detector por haversine. T4 debe degradar sin bloquear la creación del viaje.
4. **T9** — completar el disparo híbrido (sugerencia por geofence + tap).
5. **F1 cerrado.** Recién entonces **T10**, el enrutamiento de fuente de posición: con Teltonika → `telemetria_puntos`; sin Teltonika → `posiciones_movil_conductor`. Sin merge de streams.
6. **T11–13** — cobertura anclada al pickup real, umbral binario ~80%, degradación por peso ausente.

**Decisión de certificación por fuente:** resuelta en ADR-077. `movil_gps` es fuente de ruta de primera clase; solo CAN + Teltonika ≥95% da `primario_verificable`; la posición del móvil nunca da primario. Requiere migración expand-only del enum `fuente_dato_ruta` antes de T11.

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

## Slot 3 — Conductor operativo de punta a punta

**Por qué:** el Slot 1 mide la huella sobre lo que el conductor hace en ruta, y hoy ningún viaje real puede cerrarse sin que el PO intervenga: el cierre de entrega exigía un documento que ninguna pantalla sube (D1a lo destraba mientras no exista fecha de corte), el reporte GPS del móvil no sobrevive a la pérdida de señal y el conductor no ve ni mapa ni resultado. Entró el 2026-09-13 al cerrarse el slot anterior (decisión D2 del PO; antes figuraba en Congelados como «Despacho / conductor»).

**Terminado cuando:** un viaje pasa de creado a cerrado en producción sin intervención manual del PO: un conductor activado por su empresa recibe la asignación, confirma la recogida, reporta posición durante el trayecto, confirma la entrega y el certificado se emite. Y el flujo activar → recogida → posición → entrega → certificado tiene E2E Playwright verde en CI contra el API local.

**Verificación:**

```sql
SELECT v.id, a.recogido_en, a.entregado_en, m.certificado_emitido_en
FROM viajes v
JOIN asignaciones a ON a.viaje_id = v.id
LEFT JOIN metricas_viaje m ON m.viaje_id = v.id
WHERE a.conductor_id IS NOT NULL AND a.entregado_en IS NOT NULL
ORDER BY a.entregado_en DESC LIMIT 5;
```

Al menos una fila con las tres marcas de tiempo pobladas, de un viaje que el PO no tocó a mano.

**Orden de ejecución:**

1. **D1a** — el gate documental no aplica sin fecha de corte (`.specs/fix-gate-documental-sin-fecha-de-corte/`). Es lo que permite cerrar entregas hoy.
2. **Subida del documento de transporte por la oficina** en `/app/asignaciones/:id` (el endpoint `POST /transport-orders/:id/documents` existe; falta la pantalla). Con esto el PO puede fijar `REQUIRE_DOCUMENT_TO_CLOSE_SINCE` y reactivar el guard sobre una cohorte real.
3. **GPS del móvil resiliente:** un solo watcher por sesión, throttle por tiempo y distancia, cola offline con reintento, arranque al confirmar recogida y parada al entregar. Sin esto la cobertura ≥ 80 % con `movil_gps` es improbable y la huella queda siempre degradada.
4. **Lo que el conductor ve:** mapa con la ruta sugerida (reusar `AssignmentEcoRouteCard` y `GET /assignments/:id/eco-route`) y, al terminar, la línea de método de ADR-077, los kg CO2e y el certificado (decisión D3: solo lectura).
5. **Higiene:** cerrar sesión; gate por rol en `/app/conductor`; sin `window.confirm`; los comandos de voz que no están montados salen de la pantalla de configuración; el smoke E2E obsoleto se corrige.
6. **`connectAuthEmulator` en `apps/web`** y el E2E del flujo completo.

**Fuera de alcance (no se hace bajo este frente):** eco-routing en tiempo real (ADR-012 Capa 1; entra como frente nuevo cuando cierre el Slot 1), certificados PDF más allá de la línea de método que exige ADR-077, onboarding de empresas.

---

## Congelados

No se trabaja en ellos hasta que un slot se libere. Cada uno tiene condición explícita de descongelamiento.

**Sistema de diseño D1/D2.** Las primitivas existentes se usan donde ya están; no se agregan primitivas, tokens, acentos ni olas nuevas. Descongela cuando el Slot 1 cierre, y entra con criterio de cobertura sobre una lista cerrada de pantallas —nunca sobre número de primitivas—.

**Onboarding / alta de empresas.** Congelado como frente de construcción. La necesidad operativa (probar con empresas ficticias) se cubre hoy con impersonación sobre `es_usuario_prueba`. Descongela solo si esa vía resulta insuficiente en uso real, y en ese caso el criterio es: una empresa de prueba se crea por el flujo estándar, opera de punta a punta y no aparece en ningún reporte ni cobro.

**Certificados PDF.** Criterio a escribir cuando descongele, con esta forma: el PDF de \<tipo\> con \<campos\> se genera y valida contra el formato exigido por \<quién lo recibe\>.

**Infraestructura y observabilidad.** No termina, se convierte en operación. Criterio a escribir con esta forma: existe alerta accionable para \<lista cerrada de fallas\>, con runbook asociado.

**Despacho / conductor.** Descongelado el 2026-09-13: es el Slot 3 («Conductor operativo de punta a punta»), con ese mismo criterio.

---

## Cerrados

**Cierre documental de SEC-001** — ocupó el Slot 3 hasta el 2026-09-13. Criterio cumplido: los documentos listados en su definición declaran estado terminal en el encabezado (`.specs/sec-001-h1-2-google-blocking/`, `-a/`, `-b/`, `.specs/sec-001-cierre/plan-sprint-2a.md` y `plan-sprint-2b.md`); `-c/` ya estaba `SUPERSEDED`; ADR-054 ya declaraba `Superseded by ADR-057` desde 2026-06-04 y no requirió enmienda. El modo destructivo del reaper sigue fuera de slot, como estaba escrito.

---

## Deuda de documentación (no es frente; se corrige al pasar)

`README.md` está desactualizado y es la cara pública del repo: dice Node 22 (es 24), pnpm 9 (es 10), lista `agent-rigor` como parte del stack (descontinuado por ADR-072), dice "ADRs 001..050" (van 074), y escribe "FMS150" donde el equipo es **FMC150**.
