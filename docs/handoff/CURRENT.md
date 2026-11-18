# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-18 · America/Santiago (rediseño de Booster Fleet y lectura completa de 7 días en prod, con la corrección de memoria; falta verlos con sesión).  
**Prod**: `5eaf4d38` (Release [44324827630](https://github.com/boosterchile/booster-ai/actions/runs/44324827630) SUCCESS, terminó el 2026-11-18 a las 12:13) — api `booster-ai-api-00488-phv` @ **100 %**, web `00430-4xj` @ 100 %; los 8 servicios en esa imagen. Segundo release del día: el de las 09:53 (`cbe37242`) llevó el rediseño de Booster Fleet, la lectura completa de 7 días, #1008, #1006 y #1004; este agrega la corrección de memoria ([#1023](https://github.com/boosterchile/booster-ai/pull/1023)). Sin migraciones.  
**`main`**: tip `5eaf4d38` (#1023), igual a prod. Nada pendiente de deploy.  
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Score producto (P)

- **P ≈ 3.2–3.5/5** tras **E1** (BARH-23/24 en prod). Meta 5: E2–E8 en oneshot.
- **C (comercial/legal)** aparte — no mezcla con funcionamiento.
- Oneshot: [`2026-11-16-score-p5-barh2324-oneshot.md`](./2026-11-16-score-p5-barh2324-oneshot.md).

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `5eaf4d38` | Igual a prod |
| Prod | `5eaf4d38` | Release 44324827630; los 8 servicios al 100 % en su última revisión |

**Flags conservados:** matching `activa`, `RUTAS_API_ACTIVADA=true`, `EMAIL_FROM=Booster <contacto@boosterchile.com>`.  
**Smoke (2026-11-18, tras el segundo release):** `/booster-fleet` respondió 200 dos veces (4,6 s y 3,5 s la petición completa; la primera pasa el objetivo de 4 s). Sin errores del api ni caídas del contenedor desde el deploy. **Sin ver con sesión:** `/app/booster-fleet` y el detalle del vehículo con telemetría real, el histograma `booster_fleet_lectura_combustible_ms` y el panel de costos del platform-admin (arreglo de #1006).
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

**Lenguaje del aviso de combustible** (decisión del PO, 2026-11-17): la interfaz no dice «robo». [#1008](https://github.com/boosterchile/booster-ai/pull/1008), en prod desde el 2026-11-18, cambia los textos en Booster Fleet, trayectos Teltonika, el mapa del evento, los umbrales de la empresa y la ficha del vehículo: «desviación de combustible» (por analizar) para la baja de golpe y «desviación gradual» para las bajas chicas repetidas. Los nombres del contrato (`posible_robo`, `posible_robo_combustible`, `umbral_robo_hormiga_l`) no cambian. La regla quedó en la spec. No se revisaron notificaciones ni plantillas de WhatsApp.

**Rediseño** (spec aceptada el 2026-11-17, `.specs/booster-fleet-rediseno/`; plan en `plan.md`): dirección A, triage por severidad, con el detalle de vehículo sobre un eje de tiempo. Tres PRs, en prod desde el 2026-11-18:

- [#1011](https://github.com/boosterchile/booster-ai/pull/1011), en `main`: el API entrega por trayecto el inicio, el fin y los litros de la baja, y el panel trae la desviación más reciente de cada camión con su trayecto y sus coordenadas. Solo agrega campos.
- [#1012](https://github.com/boosterchile/booster-ai/pull/1012), en `main`: `/app/booster-fleet` pasa a ser el panel de triage (frase de estado, barra de severidad, combustible agrupado por tono, riel de documentos y mantenciones, modales para programar y cancelar).
- [#1013](https://github.com/boosterchile/booster-ai/pull/1013), en `main`: detalle del vehículo en `/app/booster-fleet/vehiculos/$id`.

**Visto en local con una desviación sembrada** (2026-11-17): se cargaron en la base de desarrollo puntos de telemetría del camión del seed E2E con una baja de nivel con el camión detenido, y la desviación pasó por el segmentador del API hasta el overview y el detalle, con su hora, sus litros y sus coordenadas. Al verla aparecieron tres fallas que corrigió [#1015](https://github.com/boosterchile/booster-ai/pull/1015), en `main`: el detalle no mostraba los trayectos sin dato de combustible, la fila de la desviación se partía en dos líneas y el nivel de estanque se leía mal. **Falta ver:** el mapa del evento (el entorno local no tiene clave de Google Maps), un camión sin lectura y con trayectos en el detalle (solo cubierto por test) y todo el rediseño con telemetría de producción. El nombre del lugar en palabras (C3 de la spec) no entra: se muestran coordenadas y el mapa.

**Lectura completa de 7 días** (spec aceptada el 2026-11-17, `.specs/booster-fleet-ventana-completa/`; plan en `plan.md`). El panel decía «últimos 7 días» y leía los 20.000 puntos más recientes de toda la flota. Medido en prod en solo lectura: las dos flotas con telemetría superan ese tope, y en la más grande (8 camiones, unos 198.000 puntos por semana) el panel alcanzaba a leer unas 6,4 horas. Tres PRs, en prod desde el 2026-11-18: [#1018](https://github.com/boosterchile/booster-ai/pull/1018) lee por vehículo solo los AVL que usa el segmentador, con un presupuesto de 400.000 puntos (`BOOSTER_FLEET_PRESUPUESTO_PUNTOS`) y el campo nuevo `combustible.cobertura_desde`; [#1019](https://github.com/boosterchile/booster-ai/pull/1019) guarda esa lectura en Redis por 10 minutos y lee de la base si Redis falla; [#1020](https://github.com/boosterchile/booster-ai/pull/1020) hace que el aviso de recorte diga desde cuándo son las cifras. **Para mirar en prod:** el histograma `booster_fleet_lectura_combustible_ms`; en local, con 200.000 puntos sintéticos, la lectura de la base tomó unos 3 s contra un objetivo de 4 s, y desde la caché entre 1 y 4 ms. **Decisión del PO (2026-11-18):** `cobertura_desde` queda como está, informando el punto más antiguo leído de toda la flota; solo importa cuando una flota supera el presupuesto.

**Incidente del 2026-11-18** (unos 100 minutos con el panel de la flota más grande sin cargar; resuelto). Con el primer release, abrir ese panel agotaba la memoria del API: la lectura traía los puntos por vehículo pero los juntaba todos antes de segmentar, y el heap de Node es de unos 500 MB. El contenedor se cayó tres veces entre las 10:32 y las 10:34, y cada caída cortó las demás peticiones que atendía. [#1023](https://github.com/boosterchile/booster-ai/pull/1023) segmenta cada vehículo al leerlo, pide las filas por tandas de 5.000, limita a 40.000 los puntos por vehículo y hace que dos consultas simultáneas de la misma flota compartan una lectura. En prod desde las 12:13. **Lección:** la medición de tiempos de #1019 se hizo sin el tope de memoria de prod; las mediciones de lectura se corren con `--max-old-space-size=512`. Medido así, el arreglo pasa con 256 MB y cae con 160: el margen es de dos veces. La mitigación por variable (`BOOSTER_FLEET_PRESUPUESTO_PUNTOS`) no se aplicó; rige el valor por defecto.

**Configuración de la flota más grande** (prod, solo lectura, 2026-11-17): de sus 12 vehículos activos, 4 no tienen Teltonika y 6 están configurados sin sensor de combustible, aunque 3 de esos envían nivel o consumo. Solo 2 tienen fuente y capacidad de estanque, y usan consumo acumulado, que no sirve para detectar una baja con el camión detenido. Con esa configuración el panel no puede mostrarle una desviación a esa flota. Se corrige configurando la fuente y la capacidad de cada camión, no con código.

## Agente

Observar/anotar E2–E8; **no** aprueba Environment `production` (ADR-076). `cursor-agent` tiene `run.developer`; no tiene `actions:write`. Release a prod vía `release.yml` (dispatch) o `release-on-request.yml` (archivo en `.github/release-requests/`) + Approve humano.

## Riesgos

Staging no existe: lo que entra a `main` se prueba por primera vez en prod. Matching `activa` aún sin observación real. Demo domain vivo. SMS Twilio faltante. Certs solo secundarios / cifras bajas sin reemitir.
