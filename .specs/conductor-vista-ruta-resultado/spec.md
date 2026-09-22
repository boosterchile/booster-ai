# Lo que el conductor ve: ruta sugerida y resultado del viaje (Slot 3, paso 4)

**Estado**: aceptada (PO: «arranca la vista del conductor», 2026-09-15) · **Slot**: 3 «Conductor operativo», paso 4 de `docs/frentes-vivos.md`: «mapa con la ruta sugerida (reusar `AssignmentEcoRouteCard` y `GET /assignments/:id/eco-route`) y, al terminar, la línea de método de ADR-077, los kg CO2e y el certificado (decisión D3: solo lectura)».

## 1. El problema

La tarjeta del conductor no muestra la ruta sugerida ni, al entregar, el resultado: hoy tras
«Confirmar entrega» solo dice «Entrega confirmada. ¡Gracias!». El conductor no ve cuánto
CO2e midió su viaje ni que existe un certificado. Además, los endpoints que exponen métricas y
certificado (`GET /trip-requests-v2/:id` y `…/certificate/download`) están acotados al
**generador de carga** (`trips.generador_carga_empresa_id = empresa activa`): el conductor,
miembro de la transportista, recibe 404.

## 2. Entradas y salidas

**API, dos endpoints de solo lectura (supuesto: dentro del paso 4 aprobado; se declara en el
PR para que el PO lo ratifique):**

- `GET /assignments/:id/resultado` → `{ assignment: { id, status, picked_up_at, delivered_at },
  trip: { id, tracking_code }, metrics: <serializeTripMetrics> | null,
  certificate: { issued_at, sha256, verify_url } | null }`.
- `GET /assignments/:id/certificate/download` → `{ download_url, expires_in_seconds, tracking_code }`
  (signed URL 5 min, misma ruta de objeto que la del generador). 404 `certificate_not_issued`
  si aún no existe; 503 `certificates_disabled` sin bucket.
- Autorización, la misma que `confirmar-recogida`: el **conductor asignado**
  (`assignments.driver_user_id = usuario`) o un miembro de la transportista con escritura
  (dueño/admin/despachador). Otro: 403 `forbidden`. Nunca precios.

**Web, tarjeta del conductor:**

- Fases `por_recoger` y `en_ruta`: `<AssignmentEcoRouteCard>` (colapsada por defecto; el mapa
  carga solo al abrirla, para no gastar datos en ruta).
- Fase `entregada`: `<ResultadoViaje>`: kg CO2e reales (o estimados si la huella quedó
  degradada, con la razón), distancia real y cobertura, nivel de certificación en palabras y la
  línea de método de ADR-077; «Descargar certificado» cuando existe; mientras se emite,
  «Certificado en proceso» con reintento automático cada 3 s durante 1 minuto. Solo lectura (D3).
- Limitación declarada: `/me/assignments` lista solo asignaciones activas, así que el resultado
  se ve en la sesión en que se entregó; si el conductor recarga, la tarjeta desaparece. Ampliar
  el listado a entregadas recientes es cambio de contrato: deuda con OK del PO.

## 3. Criterios de salida

- [x] Rojo exhibido: 10 tests de los dos endpoints (401, 403 ajeno y otra empresa, 200 conductor
      asignado y despachador, metrics/certificate null, 404, signed URL, 404 sin certificado, 503) y
      3 de la tarjeta (ruta eco antes de entregar; resultado con descarga; certificado en proceso).
- [x] Verde: suites `apps/api` (170/2076) y `apps/web` (136/1362), typecheck, biome, build.
- [x] Preview `/apariencia/conductor`: «Ruta eco-eficiente sugerida» colapsada en `por_recoger` (375×812).
- [ ] En producción, en el viaje sin Teltonika: el conductor ve el resultado y descarga el PDF. — evidencia parcial (2026-09-22): BOO-LCTSE5 y BOO-83ND2C (KXSV65, sin Teltonika; api 00607-xow, web 00380-gxx). PATCH confirmar-entrega → 200 con actor_user_id = conductor asignado (rol único `conductor`); luego, desde la misma IP y el mismo UA iPhone, GET /resultado 200 ×2 y GET …/certificate/download 200; y en GCS, `storage.objects.get` del PDF con ese UA (15:51:18Z y 19:40:57Z del 21-09). Falta el uid o rol de quien pidió /resultado y /download: el log de request no lo trae, y el mismo UA aparece también en sesiones de oficina y de generador.
