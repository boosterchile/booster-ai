# Spec: dispositivos Teltonika desde platform-admin

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-09-27
- Status: Accepted — el PO pidió habilitar camiones con Teltonika desde el admin, sin entrar a la cuenta del transportista.
- Linked: ADR-035 (la credencial del transportista no se comparte), panel `/app/admin/dispositivos` (sigue siendo el de la empresa)

## 1. Objective

Que un platform-admin escriba el IMEI de un Teltonika ya instalado y configurado en un camión que ya existe, sin iniciar sesión en la cuenta del transportista y sin esperar a que el equipo aparezca como pendiente del gateway.

## 2. Success criteria

- [ ] SC1 — `GET /admin/plataforma/dispositivos` lista los pendientes. Sin sesión, 401. Fuera del allowlist, 403. No exige membresía de empresa.
- [ ] SC2 — `GET /admin/plataforma/dispositivos/vehiculos?empresa_id=` lista patentes e IMEI actual de esa empresa.
- [ ] SC3 — `POST /admin/plataforma/dispositivos/asignar` con `vehiculo_id` y `teltonika_imei` (15 dígitos) escribe `vehiculos.teltonika_imei`. Si el IMEI no tiene fila en `dispositivos_pendientes`, igual queda asignado (`sin_registro`): el alta es interna, el equipo ya está instalado.
- [ ] SC4 — IMEI ya usado por otro camión → 409 `imei_en_uso`. IMEI con formato inválido → 400. Camión con IMEI espejo → 422 `imei_espejo_activo`.
- [ ] SC5 — El panel pide transportista, patente e IMEI. No exige elegir un pendiente del gateway.

## 3. Out of scope

- Rechazar dispositivos desde este panel.
- Encender el gateway Teltonika.
- Entrar a la cuenta del transportista.

## 4. Enmienda 2026-09-28

El PO aclaró el proceso: Booster instala el Teltonika y después lo habilita para la empresa. Habilitarlo incluye cargar los datos del vehículo para que quede asignado a esa empresa. Esos datos los puede cargar la empresa en su flota o Booster desde este panel. El camino de esta spec —IMEI sobre un vehículo que ya existe— sigue vigente. El alta del vehículo desde el admin está en `.specs/habilitar-vehiculo-teltonika/spec.md`.
