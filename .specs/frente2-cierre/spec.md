# Cierre del frente 2: lo medido, el nivel, el viaje propio certificado y «Pedir a Booster»

**Estado**: aceptada por el PO en el chat del 2026-11-26 («termina frente 2» y respuestas a las cuatro preguntas) · **Fecha**: 2026-11-26

Sigue a `.specs/sello-huella-toda-la-web` (toda cifra con su sello) y
`.specs/observatorio-por-presentacion`. Cierra lo que queda del frente 2 de
[`FRENTES.md`](../../docs/design/rediseno-2026-11-25/FRENTES.md), salvo lo que
depende de T10-05 (el primer certificado primario distinguible).

## 1. Qué hay en `main` (`50387d4b`)

- No existe la tabla de qué se midió. La web muestra la línea de método
  (ADR-077) y, solo en la vista del conductor, el nombre del nivel. Ninguna
  pantalla dice qué faltaría para subir de nivel.
- Ni el Inicio con Booster Fleet ni el del servicio completo del transportista
  muestran huella.
- `empresas.carbon_measurement_enabled` vale `false` por defecto y ningún alta
  lo ofrece (`.specs/medicion-huella-segmento` Q2: opt-in por empresa).
- Un viaje propio no crea `metricas_viaje`: no se mide ni se certifica. Con
  cliente externo no hay empresa generadora y la emisión se salta
  (`no_shipper`). El transportista no ve certificados fuera de la vista del
  conductor; no hay envío al cliente ni total por cliente.
- `sin_sensor` en Booster Fleet dice «Revisar sensor» y lleva a la ficha, donde
  el dueño edita él mismo la fuente CAN de combustible.
- No existe la pantalla de elegir transportista (ADR-095 sin spec).

## 2. Decisiones del PO (2026-11-26)

| # | Pregunta | Decisión |
|---|---|---|
| D1 | Medición | **Encendida en el alta.** Las empresas nuevas nacen con la medición encendida y se puede apagar en Empresa. Las existentes no cambian. Reemplaza el valor por defecto de `.specs/medicion-huella-segmento` Q2; el opt-in por empresa sigue. |
| D2 | Viaje propio con cliente externo | **Bajo la transportista.** El certificado se emite a nombre de la transportista con el cliente externo nombrado en el PDF. Ella lo descarga y puede enviarlo por correo al cliente (correo opcional del cliente, botón «Enviar al cliente»). |
| D3 | «Pedir a Booster» | **Solicitud al panel.** El botón crea una solicitud que el personal de Booster ve en su panel. El dueño deja de editar la fuente CAN. Tabla nueva (migración expand-only). |
| D4 | Anticipar la huella | **Al asignar vehículo** al viaje propio y en las ofertas que ve el transportista. Elegir transportista queda para el frente de ADR-095. |

## 3. Entregas (un PR cada una)

### 3.1 Lo medido y el nivel (PR 1)

- `GET` del detalle de carga, `GET /certificates`, `GET /assignments/:id/resultado`:
  `medicion`, con una fila por magnitud (distancia, combustible, peso), cada
  una con su fuente y su clase (`medido` / `modelado` / `declarado` /
  `estimado`), y `nivel` con nombre y frase de qué faltaría.
- La tabla en Carga entregada, Certificados y el resultado del conductor.
- Huella del mes en el Inicio del transportista y en Booster Fleet, por
  presentación.
- Anticipo «la huella saldrá …» al declarar el vehículo del viaje propio y en
  las ofertas del transportista.

### 3.2 Medición encendida en el alta (PR 2)

Las dos altas (panel de administración y onboarding) crean la empresa con
`carbon_measurement_enabled = true` y lo dicen en el formulario. Sin migración.

### 3.3 Viaje propio medido y certificado (PR 3)

- El viaje propio crea sus métricas como un viaje del marketplace (spec del
  viaje propio §4.6) y se certifica al entregarlo.
- Sin generador, el certificado queda bajo la transportista y nombra al
  cliente externo.
- Pantalla «Viaje propio entregado y certificado»: huella con sello,
  certificado, «Enviar al cliente» y total del mes para ese cliente.
- Correo opcional del cliente externo (migración expand-only).

### 3.4 «Pedir a Booster» (PR 4)

Solicitudes de configuración al personal de Booster, visibles en el panel; la
edición de la fuente CAN pasa al personal de Booster.

- Migración 0091 `solicitudes_booster` (expand-only); `POST /vehiculos/:id/pedir-booster`
  (gestor, idempotente: 201 nueva, 200 la abierta), `GET /admin/plataforma/solicitudes` y
  `POST /admin/plataforma/solicitudes/:id/resolver`; `fuente_combustible_can` en el alta o el
  `PATCH` de vehículos responde 403 `fuente_can_solo_booster` fuera del personal de Booster.
Al marcar resuelta una solicitud de fuente de combustible, el personal de
Booster elige la fuente CAN y queda guardada en el camión en la misma
transacción (`POST /admin/plataforma/solicitudes/:id/resolver` con
`fuente_combustible_can`): la impersonación no escribe en empresas reales.

## 4. Criterios de éxito

1. La clase de cada magnitud y la frase del nivel salen de una función pura
   probada fila por fila (TDD, rojo exhibido: dominio GLEC).
2. Un viaje propio entregado con cliente externo emite certificado bajo la
   transportista; un test de integración lo fija.
3. Una empresa creada por cualquiera de las dos altas tiene la medición
   encendida.
4. «Pedir a Booster» crea una solicitud que el panel lista.
5. `pnpm run ci` en verde en cada PR.

## 5. Fuera de alcance

- Lo que depende de T10-05.
- Elegir transportista (ADR-095).
- Encender la medición en empresas existentes.
