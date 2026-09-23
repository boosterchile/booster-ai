# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-09-23. `main` en `4c72aec` — capacidad de estanque y fuente CAN por vehículo (#719).

Este archivo es el estado breve (tope ~150 líneas). El detalle del 2026-07-25 está en [`2026-07-25-snapshot-current.md`](./2026-07-25-snapshot-current.md). Qué se construye ahora: [`docs/frentes-vivos.md`](../frentes-vivos.md) (última edición de ese tablero: 2026-09-13, #673). Este handoff no re-verifica los criterios de término de los slots.

## Tablero

Tres slots. El código avanzó después del tablero; el cierre no se re-verificó en esta pasada.

1. **Huella punta a punta.** El tablero del 2026-09-13 dejó F1 cerrado y T11 como siguiente. Después entró la huella real del segmento (#675–#677) y el opt-in de huella (#695). El criterio de término sigue siendo dos viajes reales en producción con `carbonEmissionsKgco2eActual` o degradación explícita.
2. **Limpieza demo.** #698 retiró el enforcement `es_demo` del request path. El criterio (cero archivos con `es_demo`, `isDemo`, `DEMO_` o `demo.boosterchile` en `apps/`, `packages/` e `infrastructure/`, y sin DNS ni Terraform de `demo.boosterchile.com`) no se recontó aquí.
3. **Conductor operativo.** Después del tablero entraron el gate documental sin fecha de corte (#674), el GPS resiliente (#686), la ruta y el resultado (#687), la higiene (#688), el E2E con Auth emulator (`3a02622`) y el gestor documental (`34f000a`). El criterio de término sigue siendo un viaje cerrado en producción sin intervención del PO, más el E2E verde en CI.

## Decisiones que ya rigen

- **ADR-069**: Booster no emite DTE. Recibe y archiva documentos de terceros.
- **ADR-076**: estados de vigencia; `main` se protege por checks; lo irreversible exige evidencia previa (`terraform apply`, migración `contract`, reaper destructivo). La migración de encabezados viejos (`Accepted`, `Proposed`) no está hecha: ADR-075 sigue en `Proposed` y la mayoría de ADR-001..074 conserva la etiqueta anterior. Un ADR posterior que declara «Superado» manda igual.
- **ADR-077**: certificación por fuente de posición. `movil_gps` es fuente de ruta; solo CAN + Teltonika ≥95% da `primario_verificable`.
- **ADR-078**: el repo no activa plugins ni hooks de Claude Code.
- **ADR-079 / ADR-080**: modelo comercial v3 y mandato de cobro. Vigentes. La activación en producción de ADR-080 sigue sujeta a las precondiciones de ese ADR.

## Deploy

Sigue manual (`release.yml` en `workflow_dispatch` desde 2026-07-10). El último deploy registrado en el handoff archivado es el del 2026-07-25 (revisión `booster-ai-api-00525-yus`, run `30168603524`). Este archivo no afirma un deploy posterior.

## Pendientes que el snapshot del 2026-07-25 dejó fuera de GitHub

No re-verificados el 2026-09-23: el backfill de distancia (re-deriva certificados; gate del PO), el rollout del api (`revision → null`) y la reparación física del CAN de PLFL57. Desde entonces hay chequeo read-only de salud CAN (#634) y de silencio AVL (#716). Eso no sustituye la reparación de campo.

## Cara pública

`README.md` quedó alineado el 2026-09-23 con el árbol del repo (FMC150, sin emisión de DTE, sin packages inexistentes, ADR hasta 080). Los encabezados viejos de los ADR no se migraron.
