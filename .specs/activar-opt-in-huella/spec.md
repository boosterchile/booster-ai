# Spec — Activar opt-in de medición de huella a nivel empresa

| Campo | Valor |
|---|---|
| **Feature slug** | `activar-opt-in-huella` |
| **Fecha** | 2026-09-21 |
| **Estado** | Aceptada (mandato Orquestador / Slot 1) |
| **Owner (PO)** | Felipe Vicencio — `dev@boosterchile.com` |
| **Origen** | Cierra el pendiente de Task 13 en `.specs/medicion-huella-segmento/plan.md`: «Exigir peso en el punto de activación queda pendiente hasta que exista un endpoint/UI de activación del opt-in» |
| **Rama** | `cursor/activar-opt-in-huella-cbf8` |

---

## 1. Problema

Las columnas `empresas.carbon_measurement_enabled` (bool NOT NULL default false) y `trips.carbon_measurement_override` (nullable) ya están en `main` (migración 0046). El resolver `resolverOptInHuella` y el cómputo post-entrega (T11–T13) respetan el flag.

Sin API ni UI, en producción el opt-in queda **siempre OFF** salvo un `UPDATE` a mano. Un dueño/admin no puede activar la medición de huella.

## 2. Objetivo (mínimo viable)

Un dueño o admin de la empresa activa (membresía activa) puede **activar y desactivar** `carbon_measurement_enabled` desde la app, sin SQL. El estado de la UI refleja el flag persistido. El guardado no miente.

## 3. Entradas

- Columna existente `empresas.carbon_measurement_enabled`.
- Membership activa del caller (`userContext` + header `X-Empresa-Id`). El `empresa_id` **nunca** viene del body ni de la URL.
- Roles que escriben: `dueno` | `admin`. El resto (despachador, visualizador, conductor, stakeholder) no muta.
- Body Zod: `{ carbon_measurement_enabled: boolean }`.

## 4. Salidas

### API

- `GET  /me/empresa` — lee el flag de la empresa activa.
- `PATCH /me/empresa` — escribe el flag. Idempotente: mismo valor → 200 `unchanged: true` sin write extra.

Authz:

- 401 sin `userContext`.
- 403 `no_active_empresa` sin membresía activa.
- 403 `no_es_empresa` si la membresía no apunta a una empresa (XOR stakeholder).
- 403 `admin_required` si el rol no es `dueno|admin`.
- 404 `empresa_not_found` si la fila desapareció (no se filtra existencia de otra empresa: el id sale de la membresía).
- 400 Zod si el body no es `{ carbon_measurement_enabled: boolean }`.

Observabilidad (endpoint nuevo): log estructurado (`empresaId`, valor anterior/nuevo, `unchanged`, `actorUserId`; sin PII), span OTel `empresa.carbon_measurement`, métrica `huella_opt_in_cambios_total`.

### Web

- Pantalla `/app/empresa` (configuración de la empresa), visible en el sidebar para dueño/admin de **cualquier** empresa (generador, transportista o dual).
- Switch nativo con label **«Medí la huella de carbono en mis viajes»** (copy rioplatense, vos) + texto corto de qué implica.
- Estado inicial = GET. Guardado = PATCH. Feedback honesto: no se marca éxito hasta que el API responde; error no deja el switch en un estado inventado.

### Fuera de alcance

- Override por viaje (`trips.carbon_measurement_override`) — no hay patrón de UI de override; queda heredando de empresa.
- Gate duro de peso en el momento de activar (bloquear el PATCH si hay viajes sin `cargoWeightKg`). El cómputo ya degrada (`*Actual = null`, nunca `0`). El copy de la UI lo declara. El DTO de alta de carga ya exige peso `> 0`.
- `es_demo`, Fleet, retorno, matching-engine, storage docs, certificados PDF nuevos, ADR-077, recálculo GLEC.
- `docs/frentes-vivos.md` no se toca.

## 5. Criterios de aceptación

1. Un dueño/admin activa el flag de su empresa activa por API: `PATCH /me/empresa` `{ carbon_measurement_enabled: true }` → 200 y la columna queda `true`. Cero SQL.
2. El mismo caller lo desactiva: queda `false`. Idempotente si ya estaba en ese valor.
3. Un despachador/visualizador recibe 403 `admin_required`. Un token sin membresía, 403 `no_active_empresa`. Sin sesión, 401.
4. El `empresa_id` no se acepta del cliente: no hay forma de mutar otra empresa conociendo su UUID.
5. En `/app/empresa` un admin ve el switch en el valor real; al toggle-arlo, el valor persiste y un mensaje confirma lo que pasó (activar vs desactivar). Si el PATCH falla, el switch vuelve al valor anterior y se anuncia el error.
6. Tests Vitest API + web verdes. Typecheck y biome de lo tocado verdes.

## 6. Rollback

Revert del PR. No hay migración. El flag escrito queda; se revierte con el mismo PATCH o SQL de ops si hiciera falta.
