# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-23 · America/Santiago (retiro de la superficie demo, parte 2, desplegado y aplicado: la migración 0088 corrió en prod y el PO corrió el `terraform apply`. Certificado con factores versionados y referencia HuellaChile en prod; falta ver uno emitido. Booster Fleet en prod, falta verlo con sesión. Reemisión por distancia no plausible cerrada: los cinco certificados quedaron en versión 2).  
**Prod**: `267e7e0e` (Release [45273910100](https://github.com/boosterchile/booster-ai/actions/runs/45273910100) SUCCESS, terminó el 2026-11-23 a las 22:35Z; lleva #1053; los 8 servicios de Cloud Run en esa imagen al 100 %, api `booster-ai-api-00496-n8c` y web `00438-gz7`). Releases anteriores del mismo día: `adb83021` ([45261904475](https://github.com/boosterchile/booster-ai/actions/runs/45261904475), #1049, solo web), `fdc43f11` (45245572913, #1047 y la migración 0089) y `52da4c1b` ([45192156923](https://github.com/boosterchile/booster-ai/actions/runs/45192156923), migración 0088 y #748, #1036, #1037, #1039). El anterior fue el del 2026-11-20 (`93f084f1`).  
**`main`**: tip `e12424be` (#1055), igual a prod salvo documentación. Nada de código pendiente de deploy ni de `apply`: los cinco movimientos de dirección de #1050 quedaron grabados en el state el 2026-11-23.
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Servicios por empresa (primer cliente solo con Booster Fleet)

**En prod desde el 2026-11-23** ([#1047](https://github.com/boosterchile/booster-ai/pull/1047), spec `.specs/servicios-por-empresa/`, pedido del PO el 2026-11-23). El platform-admin apaga por empresa las ofertas de carga: la empresa sale del matching y su menú e Inicio quedan sin Ofertas, Cobra hoy, Liquidaciones ni Zonas de matching; conserva Booster Fleet, la flota y sus viajes propios. Migración **0089**, expand-only (`empresas.recibe_ofertas_carga`, por defecto `true`). Booster Fleet no se puede apagar por empresa: quedó fuera de alcance.

Verificado en prod en solo lectura tras el release [45245572913](https://github.com/boosterchile/booster-ai/actions/runs/45245572913): los 8 servicios de Cloud Run sirven `fdc43f11` al 100 % (api `00494-4pr`, web `00436-hdw`); `Drizzle migrate() complete` a las 19:16Z (America/Santiago 16:16) y las tres columnas existen en `empresas`; sin entradas de severidad ERROR en la revisión nueva; las 8 empresas siguen con `recibe_ofertas_carga = true`, sin cambios registrados.

**Interfaz propia de Booster Fleet, en prod desde el 2026-11-23** ([#1049](https://github.com/boosterchile/booster-ai/pull/1049), release [45261904475](https://github.com/boosterchile/booster-ai/actions/runs/45261904475); spec `.specs/booster-fleet-interfaz/`, pedido del PO el 2026-11-23): la empresa transportista, no generadora y sin ofertas de carga ve el producto Booster Fleet: marca «Booster Fleet», el panel de flota como Inicio del dueño y del admin, y un menú con las secciones «Flota» y «Viajes propios». Solo web, sin API ni migración. Los dos planes, según el PO: Booster Fleet es solo gestión de flota; Booster incluye los dos servicios. Visto en un navegador con `/apariencia/shell?rol=fleet`. Tras el release, los 8 servicios sirven `adb83021` al 100 % (web `00437-j9v`, api `00495-vfc`), sin entradas de severidad ERROR en el api ni en la web. Ninguna empresa la ve todavía: todas siguen con ofertas de carga habilitadas. El cobro todavía no distingue los dos planes.

**Para dejar operativo al cliente** (visto en prod en solo lectura el 2026-11-23: empresa activa, 2 vehículos con Teltonika enviando, 0 conductores, 0 zonas, dueño sin activar con el código vencido el 2026-10-04):

1. En el panel, «Configuración comercial» → «Ofertas de carga»: deshabilitar a la empresa. «Booster Fleet» en la misma página define su tarifa.
2. En «Activar empresa», generar un código nuevo para el dueño y entregárselo (el panel no lo envía por correo).
3. El dueño activa en `/activar`, crea sus conductores y abre Booster Fleet.
4. Configurar la fuente de combustible y la capacidad de estanque de sus camiones; sin eso Booster Fleet no muestra combustible.

**Sin ver:** la web con la bandera apagada en un navegador y el panel con sesión (cubiertos por tests de componente), y el viaje propio y la activación de un conductor nuevo de punta a punta en prod.

## Score producto (P)

- **P ≈ 3.2–3.5/5** tras **E1** (BARH-23/24 en prod). Meta 5: E2–E8 en oneshot.
- **C (comercial/legal)** aparte — no mezcla con funcionamiento.
- Oneshot: [`2026-11-16-score-p5-barh2324-oneshot.md`](./2026-11-16-score-p5-barh2324-oneshot.md).

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `e12424be` | Igual a prod salvo documentación |
| Prod | `267e7e0e` | Release 45273910100; los 8 servicios de Cloud Run en esa imagen, el api al 100 % en `00496-n8c` |

**Flags conservados:** matching `activa`, `RUTAS_API_ACTIVADA=true`, `EMAIL_FROM=Booster <contacto@boosterchile.com>`.  
**Release 45273910100 (visto en solo lectura a las 22:40Z):** `Drizzle migrate() complete` en `00496-n8c` a las 22:03Z, sin `runMigrations failed`. La única entrada ERROR de las revisiones nuevas es la del gateway SMS al arrancar (falta la configuración de Twilio), que ya salía en las tres revisiones anteriores del día. El pod del gateway de telemetría reinició a las 22:34Z. El smoke de la línea siguiente es del release `52da4c1b`.  
**Smoke (2026-11-23, tras el release, solo lectura por `gcloud`):** sin entradas de severidad ERROR en la revisión nueva del api desde su arranque; flags conservados. No se probaron `/health` ni `/ready` (el proxy de la sesión bloquea `boosterchile.com`) ni el gateway de GKE. **Sin ver con sesión:** `/app/booster-fleet` y el detalle del vehículo con telemetría real, el panel de costos del platform-admin (arreglo de #1006) y un certificado emitido con la plantilla nueva (#877 y el corte de palabras de #876).
**Registros:** `Drizzle migrate() complete` en `00493-4pt` @ 14:28:00Z (America/Santiago 11:28), 495 ms, sin ningún `runMigrations failed` desde el deploy.  
**Terraform Drift Check:** el programado del 2026-11-16 18:01 falló por una sola diferencia (faltaba la variable del remitente en el api). El run [44006376104](https://github.com/boosterchile/booster-ai/actions/runs/44006376104), posterior al release BARH, terminó sin diferencias entre GCP y `main`. Los programados del 2026-11-20, 11-21 y 11-22 fallaron por #748 (el proxy HTTPS, el certificado con demo, su sufijo y el registro DNS demo); el PO aplicó esa diferencia el 2026-11-23 y la corrida manual de ese día (45230338851) salió sin diferencias. El programado del 2026-11-23 22:38Z ([45281589494](https://github.com/boosterchile/booster-ai/actions/runs/45281589494)) falló sin diferencias en GCP: #1050 movió cinco permisos de `cursor-agent@` a su índice `[0]` y `plan -detailed-exitcode` devuelve 2 mientras esos movimientos no estén en el state. El PO corrió el `terraform apply` (0 altas, 0 cambios, 0 bajas; state escrito a las 23:03Z) y la corrida manual [45285541888](https://github.com/boosterchile/booster-ai/actions/runs/45285541888) sobre `e12424be` terminó con «No changes». Lección: un PR con bloques `moved` deja el Drift Check en rojo hasta el `apply`.

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
- El 2026-11-23 se corrigieron tres defectos de la preparación que habrían roto el primer `apply` o el primer deploy (`.specs/staging-preparacion-defectos/spec.md`). GitHub pide ahora dos variables: `STAGING_API_URL` (API) y `STAGING_URL` (PWA).
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

**Lectura sin espera** (spec aceptada el 2026-11-18, `.specs/booster-fleet-lectura-sin-espera/`; plan en `plan.md`; en prod). La lectura completa de la flota más grande toma 8 a 10 s en prod, contra el objetivo de 4 s de la spec anterior: el registro por fases de [#1025](https://github.com/boosterchile/booster-ai/pull/1025) mostró el tiempo repartido (unos 4 s leyendo de la base, 2,4 s convirtiendo y 1,4 s segmentando, para unos 204.000 puntos), sin una fase culpable; la base responde cada tanda en 27 ms y el resto es CPU del API. En vez de perseguir ese tiempo, el PO aceptó que el dueño no lo espere: [#1027](https://github.com/boosterchile/booster-ai/pull/1027) guarda cada lectura con su hora por 24 horas y la entrega con `?combustible=guardada` (campos nuevos `combustible.leido_en` y `combustible.al_dia`; sin el parámetro el API responde al día, como antes), y [#1028](https://github.com/boosterchile/booster-ai/pull/1028) hace que la pantalla muestre la guardada con «Combustible leído a las HH:MM», pida la nueva y reemplace las cifras. **Medido en prod el 2026-11-18:** con una lectura guardada de 57 minutos, el panel respondió en 0,75 s (criterio 9 de la spec: menos de 1 s) y la lectura nueva llegó 8,8 s después; la primera apertura, sin lectura guardada, tardó 9,2 s. **Queda:** la primera apertura del día sigue esperando la lectura completa; una tarea programada que lea por adelantado es decisión del PO con datos de uso (spec §7.3). El objetivo de 4 s quedó reemplazado por el criterio 9.

**Configuración de la flota más grande** (prod, solo lectura, 2026-11-17): de sus 12 vehículos activos, 4 no tienen Teltonika y 6 están configurados sin sensor de combustible, aunque 3 de esos envían nivel o consumo. Solo 2 tienen fuente y capacidad de estanque, y usan consumo acumulado, que no sirve para detectar una baja con el camión detenido. Con esa configuración el panel no puede mostrarle una desviación a esa flota. Se corrige configurando la fuente y la capacidad de cada camión, no con código.

## Reemisión por distancia no plausible

**En prod desde el 2026-11-18** ([#1031](https://github.com/boosterchile/booster-ai/pull/1031), spec `.specs/reemision-distancia-no-plausible/`): esquema (migración 0087 amplía `ck_certificados_viaje_motivo`), certificado (motivo nuevo, la cifra pasa a la estimación) y escritura en prod. Cuatro certificados emitidos antes de la regla de distancia plausible publican cifras «reales» sobre distancias que no cubren el recorrido: BOO-BKAXIK (2,51 km de 500), BOO-KY7G69 (195,95 de 471,60) y la ruta de prueba BOO-4FF3XA + BOO-VZYIN2 (0,03 de 37,75; imprimen 0,02 y 0,01 kg). Dos pasos, los dos jobs en seco por defecto y los corre el PO: `corregir-distancia-no-plausible.ts` deja la huella guardada como la dejaría hoy el cierre (unidad = ruta compartida o viaje solo), y `reemitir-certificado.ts` con `MOTIVO=distancia_medida_no_plausible` emite la versión siguiente con la línea de reemplazo, un viaje por corrida. **Paso 1 ya corrido en prod por el PO (2026-11-18 23:28Z) sobre la ruta de prueba**, verificado en solo lectura: `metricas_ruta` y las dos `metricas_viaje` sin cifras reales, `maps_directions`, cobertura 0, `distancia_no_plausible`, un evento por carga; las dos v1 siguen vigentes y publican 0,02 y 0,01 kg hasta el paso 2, que ya se puede correr: la migración 0087 está en prod. BOO-BKAXIK y BOO-KY7G69 sin corregir. Muestras generadas en local el 2026-11-18 con el generador de `main`: BOO-YWKZWR v2 (Teltonika, sin sello) y BOO-4FF3XA como saldría corregido, en `.tmp-data-ops/` del checkout principal (sin versionar).

**Cierre (2026-11-19, corrido por el agente con la instrucción del PO, cada viaje en seco y luego real):** los cinco certificados quedaron reemitidos en versión 2, firmados con KMS, con la versión 1 en `reemplazado`.

| Viaje | Motivo | Cifra publicada (kg CO₂e) |
|---|---|---|
| BOO-4FF3XA | distancia medida no plausible | 0,02 → 20,864 |
| BOO-VZYIN2 | distancia medida no plausible | 0,01 → 8,127 |
| BOO-BKAXIK | distancia medida no plausible | 2,691 → 33,475 |
| BOO-KY7G69 | distancia medida no plausible | 224,092 → 539,315 |
| BOO-YWKZWR | factor impreso no corresponde | 590,746 sin cambio; el factor impreso pasa de 3,25 a 3,24 |

Verificado en solo lectura por cada viaje: versión 2 `vigente`, las métricas apuntan al certificado nuevo, evento `certificado_reemitido` con el usuario del PO, y el PDF con su firma en el bucket con el mismo sha256 que la base. Sin pendientes de esta serie. Observado y sin tocar: los certificados imprimen «—» en la fecha del viaje, y el destino de BOO-KY7G69 trae una región que no corresponde a la dirección; ambos vienen del dato del viaje y ya estaban en la versión 1.

## Certificado: factores versionados (HC-004 T2-B)

**En prod desde el 2026-11-20** ([#877](https://github.com/boosterchile/booster-ai/pull/877)). El certificado ya no imprime «Factor de emisión usado» ni «SEC Chile 2024»: imprime «Factores: WTW · TTW · WTT» con su fuente cuando la fuente guardada está en la tabla versionada (`carbon-calculator/src/factores/factores-certificado.ts`; el sufijo «(defaults para tipo: …)» del modo por defecto se ignora), y «Factor: WTW X kg CO₂e/L» sin desglose cuando no está (decisión del PO, 2026-11-20: el factor se imprime siempre). Suma la referencia HuellaChile 2025 si la fila la tiene guardada. La versión GLEC es la guardada, sin default: un viaje sin ella no se certifica ni se reemite (`version_glec_missing`); los 10 certificados de prod tienen `v3.0`. El armado vive en `armarDatosEmision`, que comparten emisión y reemisión. En prod al 2026-11-20: 3 certificados con fuente en la tabla (por el sufijo) y 7 con fuente nula y factor 3,25, que al reemitirse saldrían con la línea sin desglose. Los PDF ya firmados no cambian. **Falta:** ver un certificado emitido en prod con la plantilla nueva.

## Retiro de la superficie demo (T10-03 PR 2)

**Desplegado el 2026-11-23** ([#748](https://github.com/boosterchile/booster-ai/pull/748), `e7ad3c6c`, spec `.specs/retiro-superficie-demo-t10-03/`), en el release 45192156923. Es la fase contract del PR 1 (#745).

- **Migración 0088: corrió.** Borra la tabla `cuentas_demo`, el enum `persona_demo` y la columna `empresas.es_demo`. La revisión `00493-4pt` registró `Drizzle migrate() complete` y no hay `runMigrations failed`: si la guarda hubiera abortado, con `STRICT_MIGRATION_ORDERING=false` el api arranca igual y ese error queda en el log. No se confirmó con una consulta a la base (la sesión no tuvo acceso); las dos consultas de la guarda tampoco se corrieron antes de disparar.
- **`terraform apply`: corrido por el PO el 2026-11-23** (1 cambio y 3 destrucciones, igual al plan). Visto en GCP a las 16:37Z: el proxy HTTPS sirve solo `booster-ai-cert-40b4b7c9`, y ya no existen el certificado con demo ni el registro DNS de `demo.boosterchile.com`. El api siguió respondiendo 200.
- **`infrastructure/removed-demo.tf`: borrado** con permiso del PO. El plan del PO no listó los secretos demo, así que el state ya los había olvidado. El grep de T10-03 da 0 archivos fuera de las migraciones históricas.
- **T10-03 marcado y Slot 2 cerrado por el PO el 2026-11-23.** El Drift Check lanzado a mano el 2026-11-23 sobre `3812555c` ([45230338851](https://github.com/boosterchile/booster-ai/actions/runs/45230338851)) terminó sin diferencias. Queda por ver el programado en verde.

## Cortes de conexión a Postgres (en prod desde el 2026-11-23)

[#1053](https://github.com/boosterchile/booster-ai/pull/1053), spec `.specs/errores-conexion-postgres/`. Al verificar T10-16 apareció en Error Reporting un `INSERT` fallido del telemetry-processor (34 eventos desde el 10-19, en ráfagas del tamaño del pool; los mensajes se reprocesan y no se pierde nada). El PR corrige tres defectos: el proceso se caía cuando se cortaba una conexión inactiva (5 veces el processor y 1 el api desde el 30-10), el log perdía la causa del error y escribía los valores de la consulta (IMEI y coordenadas). **Sin determinar:** por qué se cortan las conexiones; el primer corte posterior al release 45273910100 queda registrado con su causa y con el aviso «conexión inactiva del pool de Postgres terminó con error»; a las 22:40Z no había ocurrido ninguno.

## Programa TRL 10

Línea base re-verificada el 2026-11-20 (repo, GitHub Actions y GCP en solo lectura; sin acceso a la BD): [`2026-11-20-plan-trl10.md`](./2026-11-20-plan-trl10.md), con el estado de los 30 criterios y el plan de trabajo. Marcados 11 de 30: T10-06; por decisión del PO del 2026-11-20, T10-07, 08, 09, 10, 13, 15, 17 y 18; y del 2026-11-23, T10-12 y T10-03. T10-03 quedó marcado el 2026-11-23 (0088 aplicada, `terraform apply` corrido y grep en 0). El job de tests de CI corre en tres runners desde #1039 (T10-14): falta volver a medir el p95. Plazos: decisión del mandato el 2026-11-30 y Ley 21.719 el 2026-12-01.

## Agente

Observar/anotar E2–E8; **no** aprueba Environment `production` (ADR-076). `cursor-agent` tiene `run.developer`; no tiene `actions:write`. Release a prod vía `release.yml` (dispatch) o `release-on-request.yml` (archivo en `.github/release-requests/`) + Approve humano.

## Riesgos

Staging no existe: lo que entra a `main` se prueba por primera vez en prod. Matching `activa` aún sin observación real. SMS Twilio faltante. Certs solo secundarios.
