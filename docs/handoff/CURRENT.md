# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-25 · America/Santiago, noche (frente 8 del rediseño en `main` con solicitud de release fusionada, esperando la aprobación del PO; ver «Rediseño, frente 8». Del 2026-11-26 00:50Z: frente 1 y arreglo de fechas #1099 en prod, `251dfd1e`).  
**Prod**: `fdd05289` (Release [45311791220](https://github.com/boosterchile/booster-ai/actions/runs/45311791220) SUCCESS, terminó el 2026-11-24 a las 03:02Z; sin código nuevo respecto de `267e7e0e`: solo documentación, Terraform y workflows; los 8 servicios de Cloud Run en esa imagen al 100 %, api `booster-ai-api-00497-x44` y web `00439-bd5`; la única entrada ERROR es la ya conocida del gateway SMS al arrancar; las revisiones nuevas leen la versión 5 de `twilio-auth-token`, cargada por el PO ese día; comprobado a las 03:30Z con un WhatsApp real: el bot respondió 200 a los tres webhooks de Twilio y la respuesta figura enviada y entregada). Release anterior: `267e7e0e` (Release [45273910100](https://github.com/boosterchile/booster-ai/actions/runs/45273910100) SUCCESS, terminó el 2026-11-23 a las 22:35Z; lleva #1053; los 8 servicios de Cloud Run en esa imagen al 100 %, api `booster-ai-api-00496-n8c` y web `00438-gz7`). Releases anteriores del mismo día: `adb83021` ([45261904475](https://github.com/boosterchile/booster-ai/actions/runs/45261904475), #1049, solo web), `fdc43f11` (45245572913, #1047 y la migración 0089) y `52da4c1b` ([45192156923](https://github.com/boosterchile/booster-ai/actions/runs/45192156923), migración 0088 y #748, #1036, #1037, #1039). El anterior fue el del 2026-11-20 (`93f084f1`).  
**`main`**: adelante de prod (`251dfd1e`) con el frente 8 (#1083, #1103, #1104, #1105), en solicitud de release. Pendiente de `apply`: `infrastructure/observatorio.tf` (#1096, vistas del observatorio con umbral 1).
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Rediseño, frente 8: un solo sistema visual

**En `main`, con solicitud de release fusionada y esperando la aprobación del PO** (goal del PO del 2026-11-25). Specs `.specs/d18-boton-verde-y-sello/`, `.specs/frente8-menu-superior/`, `.specs/frente8-lint-botones/` y `.specs/frente8-regresion-visual/`.

- **Sello de huella** (#1083): botón principal verde (D-18). `FootprintSeal` muestra «Medido» solo con `primario_verificable`; la presentación intermedia conserva «Distancia medida con Teltonika · consumo modelado»; lo demás es «Estimado» (decisión 2 del PO). Se ve en la huella de una ruta y en la ficha de Flota del panel; el resto de las pantallas con cifras de huella es el frente 2.
- **Armazón** (#1103): menú superior por grupos (`navGroupsForMe`, que reagrupa las mismas pantallas de `navSectionsForMe` sin abrir ni cerrar accesos), pestañas por grupo, barra inferior fija bajo 640 px y menú de cuenta (`MenuCuenta`, reemplaza `CompanySwitcher`). Sin barra lateral. Fusionar pantallas sigue siendo el frente 5.
- **Botones** (#1104): `scripts/lint-botones.mjs` corre en `pnpm lint` y falla con un `<button>` nativo, `role="button"` o un `PressableArea` pintado como botón en `apps/web/src`. Los 284 botones pasaron a `Button` (variantes `link` y tamaños `sm`, `icon` e `inline` nuevos) o `PressableArea`. Los rellenos ámbar, azules y de éxito pasaron al verde.
- **Regresión visual** (#1105): `apps/web/e2e-conductor/regresion-visual.spec.ts` compara 12 capturas (Inicios con servicio completo, con Booster Fleet, mixto y del generador; Flota; Certificados; a 1.280 y 390 px) con referencias generadas en el runner Linux del CI. Neutraliza dígitos, fechas, el saludo y los mapas; exige además que ninguna pantalla desborde a lo ancho. Para regenerar tras un cambio visual deliberado: tomar las capturas reales del artefacto `e2e-conductor-report` del job que falla.
- **Lección**: un `sr-only` es `position: absolute`; dentro de una fila con `overflow-x-auto` sin contenedor posicionado escapa del desplazamiento y ensancha la página (Flota medía 640 px en un teléfono). La fila de pestañas lleva `relative`.
- **Pendiente del frente 8, fuera de este goal**: componente de mapa común, cabecera única del panel de administración, el glosario, y el apartado «Estado actual» de `DESIGN.md`.

## Rediseño, frente 1: una sola verdad por dato

**En prod desde el 2026-11-25** (`505fbf06`, Release on request [45717367685](https://github.com/boosterchile/booster-ai/actions/runs/45717367685) SUCCESS a las 23:48Z; los 8 servicios de Cloud Run en esa imagen al 100 %, api `00499-tjv`, web `00441-5mr`; sin 5xx tras el deploy) (spec `.specs/una-sola-verdad-por-dato/`, goal del PO): formateador único de emisiones con un test guardián en `apps/web` (#1095); umbral de anonimato único de 1 camión, ADR-096 (#1096); un solo cálculo de documentos pendientes (`calcularDocumental`) en Booster Fleet, Cumplimiento, el Inicio y Conductores, vocabulario «reportando / sin lectura / sin equipo», indicadores del negocio en el Inicio del panel (`GET /admin/plataforma/indicadores`) y totales de Certificados sobre todos los certificados (#1097). La prueba `apps/web/e2e-conductor/una-sola-verdad.spec.ts` carga la misma empresa en todas esas pantallas y falla si dos difieren.

- **Fechas de documentos** (#1099, en prod desde el 2026-11-26 00:50Z, `251dfd1e`, run [45726135080](https://github.com/boosterchile/booster-ai/actions/runs/45726135080); los 8 servicios en esa imagen al 100 %, api `00500-vmw`; sin 5xx tras el deploy): `fecha_emision` y `fecha_vencimiento` son `date` y drizzle las declaraba `timestamp`; `/documentos/vehiculo*` y `/documentos/conductor*` respondían 500. Sin tráfico real a esas rutas desde el deploy: lo prueba el test de integración.
- **Pendiente del PO**: `terraform apply` de `observatorio.tf` para que el observatorio use el umbral 1 (hasta entonces filtra con 10).
- **WhatsApp, sin falla**: los 403 de `/webhooks/whatsapp` desde el 2026-11-24 son el smoke de `cloudbuild.production.yaml` (POST sin firma, `curl/7.68.0` desde IPs de GCP, uno por release). El último webhook real de Twilio (`TwilioProxy/1.1`) fue el 2026-11-24 a las 03:30Z y respondió 200; no ha llegado otro.
- Fuera del frente: el glosario completo («retiro», «publicar carga», formatos de patente, fecha y hora), anotado para el frente 8.

## Release del 2026-11-25 y traspaso del rediseño

**Prod al 2026-11-25**: `c37fa6c0` (Release on request [45635387767](https://github.com/boosterchile/booster-ai/actions/runs/45635387767) SUCCESS, terminó a las 17:18Z; Cloud Build y el smoke de `/health` pasaron; no se revisaron las revisiones de Cloud Run ni los logs). Lleva #1072 a #1078, el lema (#1080, #1081), D-18 en `DESIGN.md` (#1082) y los frentes 1 y 2 de ADR-094 (#1084, #1085) con `PRICING_V3_ACTIVATED` apagado. Sin migraciones. La línea «Prod» de arriba quedó atrás.

**No encender `PRICING_V3_ACTIVATED`** hasta cerrar los frentes 3, 4 y 5 de `.specs/comision-dentro-del-precio/spec.md`: la oferta copia el precio publicado y la liquidación suma la comisión encima.

**Staging**: el deploy falla en el paso 32 de Cloud Build en todas las corridas desde `c89cc91`; sin diagnosticar.

**Rediseño** (pedido del PO el 2026-11-25: «necesito que las maquetas entren a producción»): las 56 maquetas, sus capturas, el plan en diez frentes y el mapa verificado contra el código están en [`docs/design/rediseno-2026-11-25/`](../design/rediseno-2026-11-25/README.md). Varias pantallas ya tienen spec aceptada: la maqueta se aplica como diferencia, no como reemplazo. El PO decidió el 2026-11-25: menú superior en vez de barra lateral, «Medido» solo con huella medida, el generador elige transportista o recibe ofertas (falta ADR y spec del modelo), y cada pantalla sale a todos al liberarse (README, «Decisiones del PO del 2026-11-25»). #1083 (botón verde y sello) sigue abierto. Implementa una sola sesión, en este repositorio.

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
| `main` | `f06d656f` | Adelante de prod en #1072 a #1076 |
| Prod | `fdd05289` | Release 45311791220; los 8 servicios de Cloud Run en esa imagen, el api al 100 % en `00497-x44` |

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

**Infraestructura creada el 2026-11-24 (UTC); todavía no sirve tráfico.** El PO corrió el `terraform apply` de staging ([ADR-083](../adr/083-staging-gemelo-y-extraccion-con-shadow.md)): el proyecto `booster-ai-stg-494222` existe y los 421 recursos del plan están en su state (bucket propio `booster-ai-tfstate-stg-494222`, prefijo `terraform/staging`). Comprobado comparando el state con el plan; el agente no tiene acceso al proyecto y no vio los servicios respondiendo. Detalle y hallazgos: `.specs/staging-preparacion-defectos/spec.md`; runbook: `docs/runbooks/staging.md`.

- **Se sostiene sin el proyecto de cuota prestado** (2026-11-23, America/Santiago, desde el Mac del PO sobre `61f77537`): quitada la línea `quota_project_id` del `terraform.tfvars` local, `terraform plan` contra el state de staging terminó con «No changes. Your infrastructure matches the configuration.», sin errores de API ni avisos. El backend local volvió a prod (`booster-ai-tfstate-494222` / `terraform/state`).
- **Secretos cargados por el PO el 2026-11-24** (comprobado listando versiones, sin leer valores): `twilio-account-sid` (v2, SID de prueba), `onboarding-token-signing-secret` (v2, aleatorio de 32 bytes) y `twilio-auth-token` (v5; las v2 a v4 recibieron por error el Account SID y están deshabilitadas; de la v5 solo se comprobó el formato). De los 9 secretos que montan los servicios, siguen con placeholder `resend-api-key` (el api arranca y el correo falla) y el par `webpush-vapid-*`, que **sí bloquea el arranque del api**: `server.ts` llama a `setVapidDetails` al iniciar y `web-push` rechaza el placeholder («Vapid public key should be 65 bytes long when decoded», reproducido en local el 2026-11-24). Los otros 22 no están montados en staging.
- **Subdominio delegado** (2026-11-24, `apply` de prod corrido por el PO: 2 altas, el registro NS y la cuenta de Pub/Sub de #1064): la zona de `boosterchile.com` responde los cuatro NS de staging (`ns-cloud-d1` a `d4.googledomains.com.`), los resolutores públicos los devuelven y `api.staging.boosterchile.com` resuelve; no se probó que algo responda en esa IP. Drift Check [45305350284](https://github.com/boosterchile/booster-ai/actions/runs/45305350284) sobre `dce8de7e`, posterior al `apply`: «No changes».
- **Firebase y Maps configurados** (2026-11-24, fuera de Terraform como en prod): app web «Booster PWA (staging)» activa (`appId` `1:863084103021:web:e235a42a6bd63c68c6c664`, `messagingSenderId` `863084103021`); key «Booster Maps - Web (PWA) staging» restringida a `https://app.staging.boosterchile.com/*` y a las 8 APIs de Maps habilitadas; y `app.staging.boosterchile.com` en los dominios autorizados de autenticación. Comprobado por las APIs de Firebase, API Keys e Identity Platform. La key automática de Firebase no tiene restricción de dominio, igual que en prod.
- **GitHub (2026-11-24, creado por el PO):** Environment `staging` sin reglas de protección, con `STAGING_WIF_PROVIDER`, `STAGING_WIF_SERVICE_ACCOUNT_DEPLOY` y las `STAGING_VITE_*` de Firebase y Maps; `STAGING_API_URL` en el repositorio. **App Check:** Firebase ya no deja registrar reCAPTCHA clásico en apps nuevas; staging pasa a Fraud Defense y prod sigue con el clásico hasta migrar (`.specs/app-check-fraud-defense/`, PR en curso). En staging quedó registrado el proveedor Fraud Defense con su clave del sitio, que también está en `STAGING_VITE_RECAPTCHA_SITE_KEY`; sin aplicación obligatoria. **Staging en servicio desde el 2026-11-24** (deploy [45412433844](https://github.com/boosterchile/booster-ai/actions/runs/45412433844), build `ee9555d8`): los 8 servicios de Cloud Run sirven `f06d656f` al 100 %; el api pasó el canary, `Drizzle migrate() complete` a las 14:30Z sobre la base vacía, sin entradas ERROR; `https://api.staging.boosterchile.com/health` y `/ready` responden 200 y `https://app.staging.boosterchile.com/` también (15:01Z). El build terminó en FAILURE por su último tramo: `gke-deploy` no encontró el namespace `telemetry`, porque el gateway de telemetría de staging nunca se instaló (runbook §7). Arreglos que lo hicieron posible: hallazgos 12 y 13 de `.specs/staging-preparacion-defectos/` y `.specs/jobs-autoejecucion-en-bundle/` (#1074, #1075, #1076). **Falta (PO):** instalar el gateway en el clúster de staging (§7; mientras tanto cada deploy de staging termina en rojo en ese paso, después de desplegar Cloud Run); decidir cómo sembrar el usuario de prueba del E2E (`.specs/e2e-staging/`); `resend-api-key`, opcional; y desplegar a prod el arreglo de #1076, donde los dos jobs siguen corriendo en cada arranque del api, en modo no destructivo.
- «Deploy staging» corre en cada push a `main`: lo que entra a `main` llega primero a staging. `STAGING_URL` existe desde el 2026-11-24 y el E2E apunta a staging; su suite se rehízo para que pruebe algo (`.specs/e2e-staging/`): humo público y rate limit sobre Redis corren siempre, y las pruebas con sesión esperan un usuario de prueba, que es decisión pendiente del PO. Probado a mano ese día: api, CORS, Redis, PWA y App Check con Fraud Defense (token emitido).
- **Arreglos de la preparación (2026-11-23/24):** host de Cloud Armor y permisos de `cursor-agent@` solo en prod (#1050); bucket de state propio, porque el de prod guarda la contraseña de la base (#1057); content-sid sin montar (#1059); proyecto de cuota para el arranque (#1060).
- **Tropiezos del primer `apply`, corregidos en Terraform (#1064):** los datasets de BigQuery esperan a las APIs, la cuenta interna de Pub/Sub la pide `google_project_service_identity.pubsub` y el permiso de cert-manager espera al clúster. Aplicado por el PO en prod y en staging el 2026-11-24 («Apply complete! Resources: 1 added, 0 changed, 0 destroyed.» en staging; el plan posterior de staging da «No changes»). Sin probar en un proyecto vacío. El `terraform untaint` de `google_bigquery_table.crash_events` queda como paso del runbook: su causa no quedó registrada.
- **Costo:** USD 150 a 250 al mes desde hoy (`monthly_budget_usd = 250`).

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

Staging recibe deploys pero aún sin E2E ni gateway de telemetría. Matching `activa` aún sin observación real. SMS Twilio faltante. Certs solo secundarios.
