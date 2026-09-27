# Spec: dispositivos Teltonika desde platform-admin

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-09-27
- Status: Accepted — el PO pidió habilitar camiones con Teltonika desde el admin, sin entrar a la cuenta del transportista.
- Linked: ADR-035 (la credencial del transportista no se comparte), panel `/app/admin/dispositivos` (sigue siendo el de la empresa)

## 1. Objective

Que un platform-admin asocie un Teltonika que ya se conectó al gateway con un camión de cualquier transportista, sin iniciar sesión en esa empresa.

## 2. Success criteria

- [ ] SC1 — `GET /admin/plataforma/dispositivos` lista los pendientes. Sin sesión, 401. Fuera del allowlist, 403. No exige membresía de empresa.
- [ ] SC2 — `GET /admin/plataforma/dispositivos/vehiculos?empresa_id=` lista patentes e IMEI actual de esa empresa.
- [ ] SC3 — `POST /admin/plataforma/dispositivos/:id/asociar` con `vehiculo_id` escribe `vehiculos.teltonika_imei` y deja el pendiente en `aprobado`, aunque el admin no pertenezca a esa empresa.
- [ ] SC4 — Camión con otro IMEI → 409 `vehicle_has_other_device`. IMEI ya usado por otro camión → 409 `imei_en_uso`. Dispositivo que no está pendiente → 409 `device_not_pending`.
- [ ] SC5 — El panel `/app/platform-admin` muestra la lista, el transportista, el camión y el botón de asociar.

## 3. Out of scope

- Rechazar dispositivos desde este panel.
- Encender el gateway Teltonika.
- Entrar a la cuenta del transportista.
