# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-17 · America/Santiago (Booster Fleet en prod; rediseño y lectura completa de 7 días en `main`, sin desplegar).  
**Prod**: `b9f512d0` (Release on request [44088137366](https://github.com/boosterchile/booster-ai/actions/runs/44088137366) SUCCESS; Cloud Build `7897c23a`) — api `booster-ai-api-00486-brt` @ **100 %**, web `00428-f8j` @ 100 %. Incluye Booster Fleet (#1002) + disparador release-on-request (#1003).  
**`main`**: tip `23b1e80d` (#1020). Pendiente de deploy respecto de prod: #1006 (api, resumen de costos), #1008 (web, textos de combustible), #1011 (api, hora, litros y lugar de la desviación), #1012 (web, overview nuevo de Booster Fleet), #1013 (web, detalle del vehículo), #1015 (web, correcciones del detalle y del overview), #1018 (api, lectura completa de 7 días), #1019 (api, caché de la lectura) y #1020 (web, aviso de recorte). #1004, #1005, #1007, #1009 y #1010 no cambian producto.  
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Score producto (P)

- **P ≈ 3.2–3.5/5** tras **E1** (BARH-23/24 en prod). Meta 5: E2–E8 en oneshot.
- **C (comercial/legal)** aparte — no mezcla con funcionamiento.
- Oneshot: [`2026-11-16-score-p5-barh2324-oneshot.md`](./2026-11-16-score-p5-barh2324-oneshot.md).

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `23b1e80d` | Lo de prod + #1004 guardas + #1006 costos + #1008 textos + #1011 contrato de la desviación + #1012 overview + #1013 detalle + #1015 correcciones + #1018 a #1020 lectura completa |
| Prod | `b9f512d0` | Imagen de #1003; api/web al 100 %; canary 30 min OK |

**Flags conservados:** matching `activa`, `RUTAS_API_ACTIVADA=true`, `EMAIL_FROM=Booster <contacto@boosterchile.com>`.  
**Smoke (2026-11-17):** `/health` 200, `/ready` 200, `/booster-fleet` **401** (`{"error":"Unauthorized"}`, ruta montada), web `/app/booster-fleet` 200.  
**Registros:** `Drizzle migrate() complete` en `00486-brt` @ 13:15:11Z (America/Santiago 10:15).  
**Terraform Drift Check:** el programado del 2026-11-16 18:01 falló por una sola diferencia (faltaba la variable del remitente en el api). El run [44006376104](https://github.com/boosterchile/booster-ai/actions/runs/44006376104), posterior al release BARH, terminó sin diferencias entre GCP y `main`.

## Evidencia Score P

| # | Estado | Nota |
|---|---|---|
| **E1** | **Hecho** | Release BARH-23/24 en prod (`00483-ppx` / `00427-z4w`) |
| E2 | Pendiente | Invitados `/crear-cuenta` + login |
| E3 | Pendiente | Activación conductor solo por canal |
| E4 | Pendiente | Viaje E2E sin intervención PO → cert |
| E5 | Pendiente | Matching real o reclamo documentado |
| E6 | Pendiente | Viaje propio (`origen_alta=propio_transportista`) |
| E7 | Pendiente | Viaje sin FMC150 + DQ |
| E8 | Pendiente | Ciclo cobro técnico |

Migración **0085**: aplicada y verificada en prod el 2026-11-16 (solo lectura). Migración **0086** (`mantenciones_vehiculo`): aplicada al startup de `00486-brt` el 2026-11-17 (`migrate()` complete; sin acceso SELECT del agente a Secret Manager para contar filas en `__drizzle_migrations`).

## Staging

**No existe** (revisado el 2026-11-17, solo lectura). Lo que pide [ADR-083](../adr/083-staging-gemelo-y-extraccion-con-shadow.md) está sin crear:

- El proyecto `booster-ai-stg-494222` no aparece entre los proyectos visibles para la cuenta del PO; no se descarta uno creado bajo otra cuenta.
- `staging.boosterchile.com` no tiene delegación NS y `api.staging.boosterchile.com` no resuelve.
- El repo no tiene entorno `staging` en GitHub ni ninguna variable `STAGING_*`.
- «Deploy staging» corre en cada push a `main` y se omite siempre (sus últimos 100 runs): el job exige la variable `STAGING_PROJECT_ID`. BARH-23/24 llegaron a prod sin pasar por staging.
- Solo existe la preparación en `infrastructure/environments/staging/`. Crear el proyecto, vincular la facturación, el `terraform apply` y el registro NS en prod son pasos del PO.

## BARH-21

Invites enviados; **cuentas no confirmadas** (`gerencia@`, `sandoval.felipe@`).

## Pendientes del PO (Score P)

1. Confirmar `/crear-cuenta` de invitados (E2).
2. 1 activación conductor por canal (E3).
3. 1 viaje E2E sin parche → cert (E4).
4. 1 reclamo o matching real + 1 viaje propio (E5–E6).
5. Viaje sin FMC150 + DQ (E7); luego cobro técnico (E8).

## Booster Fleet

**En prod** (2026-11-17). Spec `.specs/booster-fleet/spec.md`. PRs [#1002](https://github.com/boosterchile/booster-ai/pull/1002) (feature) + [#1003](https://github.com/boosterchile/booster-ai/pull/1003) (release-on-request). Panel `/app/booster-fleet`, API `/booster-fleet`, migración **0086** `mantenciones_vehiculo` (expand-only; `migrate()` OK en el arranque de `00486-brt`). El cobro sigue en la bandera de gestión de flota. Oneshot: [`2026-11-17-booster-fleet-release-oneshot.md`](./2026-11-17-booster-fleet-release-oneshot.md). Queda smoke con sesión dueño/admin transportista (criterio de término en `frentes-vivos.md`).

**Lenguaje del aviso de combustible** (decisión del PO, 2026-11-17): la interfaz no dice «robo». [#1008](https://github.com/boosterchile/booster-ai/pull/1008), en `main` y sin desplegar, cambia los textos en Booster Fleet, trayectos Teltonika, el mapa del evento, los umbrales de la empresa y la ficha del vehículo: «desviación de combustible» (por analizar) para la baja de golpe y «desviación gradual» para las bajas chicas repetidas. Los nombres del contrato (`posible_robo`, `posible_robo_combustible`, `umbral_robo_hormiga_l`) no cambian. La regla quedó en la spec. No se revisaron notificaciones ni plantillas de WhatsApp.

**Rediseño** (spec aceptada el 2026-11-17, `.specs/booster-fleet-rediseno/`; plan en `plan.md`): dirección A, triage por severidad, con el detalle de vehículo sobre un eje de tiempo. Tres PRs, los tres en `main`:

- [#1011](https://github.com/boosterchile/booster-ai/pull/1011), en `main`: el API entrega por trayecto el inicio, el fin y los litros de la baja, y el panel trae la desviación más reciente de cada camión con su trayecto y sus coordenadas. Solo agrega campos.
- [#1012](https://github.com/boosterchile/booster-ai/pull/1012), en `main`: `/app/booster-fleet` pasa a ser el panel de triage (frase de estado, barra de severidad, combustible agrupado por tono, riel de documentos y mantenciones, modales para programar y cancelar).
- [#1013](https://github.com/boosterchile/booster-ai/pull/1013), en `main`: detalle del vehículo en `/app/booster-fleet/vehiculos/$id`.

Nada del rediseño está en prod. **Visto en local con una desviación sembrada** (2026-11-17): se cargaron en la base de desarrollo puntos de telemetría del camión del seed E2E con una baja de nivel con el camión detenido, y la desviación pasó por el segmentador del API hasta el overview y el detalle, con su hora, sus litros y sus coordenadas. Al verla aparecieron tres fallas que corrigió [#1015](https://github.com/boosterchile/booster-ai/pull/1015), en `main`: el detalle no mostraba los trayectos sin dato de combustible, la fila de la desviación se partía en dos líneas y el nivel de estanque se leía mal. **Falta ver:** el mapa del evento (el entorno local no tiene clave de Google Maps), un camión sin lectura y con trayectos en el detalle (solo cubierto por test) y todo el rediseño con telemetría de producción. El nombre del lugar en palabras (C3 de la spec) no entra: se muestran coordenadas y el mapa.

**Lectura completa de 7 días** (spec aceptada el 2026-11-17, `.specs/booster-fleet-ventana-completa/`; plan en `plan.md`). El panel decía «últimos 7 días» y leía los 20.000 puntos más recientes de toda la flota. Medido en prod en solo lectura: las dos flotas con telemetría superan ese tope, y en la más grande (8 camiones, unos 198.000 puntos por semana) el panel alcanzaba a leer unas 6,4 horas. Tres PRs, los tres en `main` y sin desplegar: [#1018](https://github.com/boosterchile/booster-ai/pull/1018) lee por vehículo solo los AVL que usa el segmentador, con un presupuesto de 400.000 puntos (`BOOSTER_FLEET_PRESUPUESTO_PUNTOS`) y el campo nuevo `combustible.cobertura_desde`; [#1019](https://github.com/boosterchile/booster-ai/pull/1019) guarda esa lectura en Redis por 10 minutos y lee de la base si Redis falla; [#1020](https://github.com/boosterchile/booster-ai/pull/1020) hace que el aviso de recorte diga desde cuándo son las cifras. **Para mirar después del deploy:** el histograma `booster_fleet_lectura_combustible_ms`; en local, con 200.000 puntos sintéticos, la lectura de la base tomó unos 3 s contra un objetivo de 4 s, y desde la caché entre 1 y 4 ms. **Pendiente de decisión del PO:** si `cobertura_desde` informa el punto más antiguo leído (como está) o la fecha desde la que todos los camiones están completos; solo importa cuando una flota supera el presupuesto.

**Configuración de la flota más grande** (prod, solo lectura, 2026-11-17): de sus 12 vehículos activos, 4 no tienen Teltonika y 6 están configurados sin sensor de combustible, aunque 3 de esos envían nivel o consumo. Solo 2 tienen fuente y capacidad de estanque, y usan consumo acumulado, que no sirve para detectar una baja con el camión detenido. Con esa configuración el panel no puede mostrarle una desviación a esa flota. Se corrige configurando la fuente y la capacidad de cada camión, no con código.

## Agente

Observar/anotar E2–E8; **no** aprueba Environment `production` (ADR-076). `cursor-agent` tiene `run.developer`; no tiene `actions:write`. Release a prod vía `release.yml` (dispatch) o `release-on-request.yml` (archivo en `.github/release-requests/`) + Approve humano.

## Riesgos

Staging no existe: lo que entra a `main` se prueba por primera vez en prod. Matching `activa` aún sin observación real. Demo domain vivo. SMS Twilio faltante. Certs solo secundarios / cifras bajas sin reemitir.
