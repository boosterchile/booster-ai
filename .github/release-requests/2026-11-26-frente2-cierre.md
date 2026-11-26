# Release request — rediseño, cierre del frente 2

**Fecha**: 2026-11-26 · America/Santiago  
**Motivo**: llevar a producción lo fusionado en `main` desde el release del observatorio por presentación (`6bcf7879`, run 45773528546), hasta la punta de `main` al fusionar esta solicitud.  
**Pedido**: del PO — «termina frente 2» (spec `.specs/frente2-cierre/`, decisiones D1 a D4 del 2026-11-26).

## Qué entra

- Qué se midió (distancia, combustible y peso, con fuente y clase) y el nivel con lo que le falta para llegar a primario, en Carga entregada, Certificados y el resultado del conductor. La huella del mes del transportista en su Inicio y en Booster Fleet. El anticipo de la huella en las ofertas y al elegir el camión (#1119).
- Las altas de empresa nacen con la medición de huella encendida; las existentes no cambian (#1120).
- El viaje propio se mide y se certifica. Con cliente externo, el certificado queda bajo la transportista y el PDF nombra al cliente (#1121).
- El correo del cliente externo, «Enviar al cliente» y la pantalla «Viaje propio entregado y certificado» con la huella del mes para ese cliente (#1122).
- «Pedir a Booster»: solicitudes de configuración al panel; la fuente CAN de combustible la configura el personal de Booster al resolverlas (#1123).
- Documentación del handoff (#1118 y esta solicitud).

## Migraciones

Dos, expand-only (ADR-066); corren al arrancar el api:

- **0090** `viajes.cliente_externo_correo varchar(254)`, anulable.
- **0091** tabla nueva `solicitudes_booster`, con checks e índice único parcial.

Ninguna toca filas existentes. Una revisión previa del api las ignora.

## Qué cambia para los usuarios

- El dueño de una transportista deja de poder cambiar la fuente CAN de combustible de sus camiones: la pide con «Pedir a Booster».
- El correo «Enviar al cliente» sale al correo que la transportista registró, con un enlace al PDF que vence en 7 días.

## Qué no cambia

- `PRICING_V3_ACTIVATED` sigue apagado.
- Nada de lo que depende de T10-05.

## Qué mirar tras el deploy

- En los registros del api, `Drizzle migrate() complete` con la 0090 y la 0091, sin `runMigrations failed`.
- Con una sesión de transportista: «Huella {mes}» en el Inicio y en Booster Fleet, y «Pedir a Booster» en un camión con `sin_sensor`.
- En el panel: `/app/platform-admin/solicitudes`.

## Gate

Este archivo dispara `Release on request`. El Environment **production** sigue exigiendo aprobación humana (ADR-076). No usa la lane `release-deploy-main`.
