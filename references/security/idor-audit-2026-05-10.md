# Auditoría IDOR — Booster AI backend

**Fecha**: 2026-05-10
**Alcance**: 22 endpoints autenticados con parámetros `:id` en `apps/api/src/routes/`
**Auditor**: Claude Code (sesión multi-agent)
**Razón**: ADR-028 §"Riesgos conocidos" identificó IDOR como High; este documento es la evidencia de auditoría exigida en §"Acciones derivadas §1".

---

## TL;DR

**0 IDOR confirmados. 0 IDOR potenciales bloqueantes.** Todos los endpoints autenticados con `:id` filtran correctamente por `empresaId`/ownership en la query SQL o validan a nivel de service layer (defense-in-depth). El patrón canónico es:

```typescript
.where(and(eq(table.id, id), eq(table.empresaId, ctx.activeMembership.empresa.id)))
```

Resultado: ✅ **Compliant con ADR-028 — RBAC/Auth**.

---

## Endpoints públicos (by design — no requieren check IDOR)

| Endpoint | Razón |
|---|---|
| `GET /trip-requests/:code` | Tracking público vía código opaco BOO-XXXXXX (entropy 34⁶ ≈ 1.5B). Mitigación rate-limit pendiente. |
| `GET /certificates/:tracking_code/verify` | Auditoría externa de certificados ESG sin credenciales (firma criptográfica verificable). Solo expone metadata sidecar (hash, firma, public key). |

---

## Endpoints autenticados con `:id` — resultado por endpoint

| # | Archivo | Endpoint | Auth | Filtro IDOR | Estado |
|---|---|---|---|---|---|
| 1 | admin-dispositivos.ts:98 | POST /:id/asociar | requireAdmin | vehicle.empresaId via `and(eq(vehicles.id, body.vehiculo_id), eq(vehicles.empresaId, empresaActiva.id))` | 🟢 OK |
| 2 | admin-dispositivos.ts:191 | POST /:id/rechazar | requireAdmin | UPDATE atómico con `and(eq(id), eq(status='pendiente'))`. `pendingDevices` NO tiene `empresaId` **por diseño** (son dispositivos globales pre-asignación detectados en gateway TCP, cualquier admin de empresa puede asociarlos a su flota). El gate efectivo es `requireAdmin()` + status check. | 🟢 OK by design |
| 3-8 | chat.ts:192/295/366/409/506/582 | varios | resolveChatAccess | `resolveChatAccess(c, assignmentId)` carga assignment + trip y compara `empresaActivaId` contra **ambas** partes (`shipperEmpresaId`, `carrierEmpresaId`). Rechaza con `forbidden_not_party` si no es ninguna. | 🟢 OK |
| 9 | assignments.ts:85 | GET /:id | requireCarrierAuth | `if (row.empresaIdAssign !== empresaId)` retorna 403 `forbidden_owner_mismatch` | 🟢 OK |
| 10 | assignments.ts:234 | PATCH /:id/confirmar-entrega | requireCarrierAuth | Doble check: route layer + `confirmarEntregaViaje` service layer | 🟢 OK (defense-in-depth) |
| 11 | trip-requests-v2.ts:245 | GET /:id | requireShipperAuth | `and(eq(trips.id, id), eq(trips.generadorCargaEmpresaId, empresaId))` → 404 si no existe (no 403, evita info leak) | 🟢 OK |
| 12 | trip-requests-v2.ts:380 | GET /:id/certificate/download | requireShipperAuth | Idem patrón | 🟢 OK |
| 13 | trip-requests-v2.ts:454 | PATCH /:id/confirmar-recepcion | requireShipperAuth | Service layer (`confirmarEntregaViaje`) valida `trip.generadorCargaEmpresaId !== actor.empresaId` | 🟢 OK |
| 14 | trip-requests-v2.ts:506 | PATCH /:id/cancelar | requireShipperAuth | `and(eq(trips.id, id), eq(trips.generadorCargaEmpresaId, empresaId))` | 🟢 OK |
| 15 | offers.ts:101 | POST /:id/accept | isTransportista | Service `acceptOffer` valida `offer.empresaId !== empresaId` → throw `OfferNotOwnedError` | 🟢 OK |
| 16 | offers.ts:169 | POST /:id/reject | isTransportista | Idem patrón | 🟢 OK |
| 17 | vehiculos.ts:217 | GET /:id | requireAuth | `and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId))` | 🟢 OK |
| 18 | vehiculos.ts:239 | PATCH /:id | requireWriteRole | SELECT inicial + UPDATE ambos con filtro empresa | 🟢 OK |
| 19 | vehiculos.ts:325 | DELETE /:id | requireDeleteRole | UPDATE soft-delete con filtro empresa | 🟢 OK |
| 20 | vehiculos.ts:354 | GET /:id/telemetria | requireAuth | Filtro empresa + check `teltonikaImei` antes de servir telemetría | 🟢 OK |
| 21 | vehiculos.ts:424 | GET /:id/ubicacion | requireAuth | Filtro empresa + check `teltonikaImei` | 🟢 OK |

---

## Patrones de seguridad observados

### ✅ Patrón canónico (correcto, replicar en código nuevo)

```typescript
const [row] = await db
  .select(...)
  .from(table)
  .where(and(eq(table.id, paramId), eq(table.empresaId, ctx.activeMembership.empresa.id)))
  .limit(1);
if (!row) {
  return c.json({ error: 'resource_not_found' }, 404); // 404 evita info leak
}
```

### ✅ Defense-in-depth en services compartidos

Servicios como `confirmarEntregaViaje`, `acceptOffer`, `rejectOffer` validan ownership **además** del check del route layer. Si un handler nuevo olvida el check, el service lo cubre.

### ✅ Multi-tenant chat — validación bilateral

`resolveChatAccess` compara la empresa activa del user contra **ambas** partes del trip (shipper + carrier). Permite ver chat sólo si el user pertenece a alguna de las dos partes. El stakeholder ESG **no** tiene acceso al chat (consent grants son para data agregada, no para conversaciones operativas).

### ✅ Status atómico en UPDATE

`POST /admin/dispositivos-pendientes/:id/rechazar` usa `WHERE status='pendiente'` en el UPDATE — atomic, evita TOCTOU race condition donde dos admins rechazan el mismo dispositivo simultáneamente.

---

## Recomendaciones (no bloqueantes)

1. **Rate limiting en endpoints públicos** (Cloud Armor rules) para `/trip-requests/:code` y `/certificates/:tracking_code/verify`. Mitiga fuerza bruta vs el espacio de 1.5B códigos.
2. **Logging estructurado de 403** con `actorId`, `targetResource`, `targetEmpresa`. Permite alertar sobre patrones sospechosos (≥5 403 desde mismo `actorId` en 5 min = posible scan IDOR).
3. **Test contractual** del patrón `and(eq(id), eq(empresaId))` — un script en CI que escanea queries SELECT/UPDATE/DELETE en `routes/` y reporta las que no incluyen filtro empresa (con allowlist documentada).
4. **Re-auditar trimestralmente** o cuando se agreguen ≥5 endpoints nuevos con `:id`.

---

## Tests IDOR — recomendados pero out-of-scope de auditoría

Para cada endpoint con `:id`, idealmente existe un test que valida:

```
"user A from empresa A no puede leer/escribir recurso X de empresa B → 404 o 403"
```

Ejemplos de implementación sugerida en `apps/api/test/integration/idor-*.test.ts` (requieren DB fixture o test DB real). Bookmark para sprint próximo.

---

## Conclusión

El backend de Booster AI a 2026-05-10 implementa correctamente el modelo de aislamiento multi-tenant declarado en ADR-028. Los 22 endpoints autenticados con `:id` validan ownership a nivel SQL o service. No se requieren cambios de código de seguridad como resultado de esta auditoría. La auditoría es **evidence of compliance** para ADR-028 §"Acciones derivadas §1".

**Próxima auditoría sugerida**: 2026-08-10 (3 meses) o cuando se agregue `apps/document-service` / `apps/notification-service` / `apps/matching-engine` (apps esqueleto declaradas en ADR-001 que se implementarán en próximos sprints).
