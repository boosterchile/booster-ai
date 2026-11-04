# Spec: habilitar un Teltonika cargando el vehículo

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-09-28
- Status: Accepted — el PO describió el proceso el 2026-09-28: Booster instala el equipo y después lo habilita para la empresa; los datos del vehículo los puede cargar Booster o la empresa.
- Linked: `.specs/admin-teltonika-plataforma/spec.md` (sigue vigente el camino «el vehículo ya está en la flota y solo se escribe el IMEI»)
- Enmienda 2026-09-28: la patente es única en el país. Si ya existe, `habilitar` actualiza ese vehículo y lo deja en la empresa elegida. No responde `plate_duplicate` salvo una carrera de insert.

## 1. Objective

Que, después de instalar un Teltonika en un vehículo, se pueda dejar ese vehículo asignado a la empresa de transportes cargando sus datos. Lo hace el admin de Booster, sin entrar a la cuenta del cliente, o lo hace la empresa en su flota. En los dos casos el vehículo queda en esa empresa. El IMEI se escribe en el mismo paso cuando lo hace Booster, o en la configuración del vehículo cuando lo hace la empresa.

## 2. Success criteria

- [ ] SC1 — `POST /admin/plataforma/dispositivos/habilitar` crea el vehículo con `empresa_id` de un transportista y `teltonika_imei` de 15 dígitos. No exige que el equipo haya llamado al gateway (`sin_registro`). Solo platform-admin. Otro usuario recibe 403.
- [ ] SC2 — La empresa tiene que ser transportista. Si no existe, 404 `empresa_no_encontrada`. Si no es transportista, 422 `empresa_no_transportista`. No se inserta el vehículo.
- [ ] SC3 — IMEI ya usado por otro vehículo, o rechazado, se rechaza (`imei_en_uso`, `imei_rechazado`). Si la patente ya existe, no se inserta otra fila: se actualiza ese vehículo a la empresa elegida (tipología, capacidad, marca, modelo, año, combustible, peso vacío, IMEI y estado activo) y se responde 200 con `ya_existia: true` y `movido` según si cambió de empresa. Un camión con IMEI espejo responde 422 `imei_espejo_activo` y no se toca. Una carrera de insert que choque con el unique de patente sigue en 409 `plate_duplicate`. La tipología se deriva del tipo legacy, como en `POST /vehiculos`. Un semi-remolque sin peso vacío responde 422 y no inserta. El alta de la empresa (`POST /vehiculos`) sigue rechazando la patente duplicada.
- [ ] SC4 — En `/app/platform-admin` el admin elige: la empresa ya cargó el vehículo (solo IMEI) o Booster carga los datos (patente, tipo, capacidad e IMEI) y el vehículo queda en esa empresa.
- [ ] SC5 — En la flota de la empresa el texto explica que ella puede cargar los datos del vehículo y que Booster también puede hacerlo. El alta de vehículo de la empresa no cambia de contrato.

## 3. Out of scope

- Que la empresa escriba el IMEI en el mismo formulario de alta. Sigue en la configuración del vehículo.
- Rechazar dispositivos, encender el gateway, o entrar a la cuenta del transportista.
