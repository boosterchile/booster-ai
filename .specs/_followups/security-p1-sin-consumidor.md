# Follow-up — Eventos de seguridad P1 (remolque y geocerca): nadie los detecta, publica ni consume

**Fecha**: 2026-10-21
**Origen**: revisión de seguridad del PR #822 (min_instances de notification-service), 2026-10-21. El PR #822 no cambia este comportamiento.
**Estado**: diagnóstico cerrado. **Requiere decisión del PO.** Sin cambios en prod; nada implementado ni aplicado.
**Dominio**: seguridad física / antirrobo (dominio crítico si se implementa: TDD obligatorio).

---

## Resumen

1. **El hallazgo se confirma y es más amplio de lo descrito.** No solo faltan publicador y consumidor del topic `telemetry-events-security-p1`: **telemetry-processor ni siquiera detecta los eventos**. Solo reconoce Unplug (AVL 252) y GNSS Jamming (AVL 318), más Crash (247) por `crash-traces`. Towing (AVL 246) y Auto Geofence (AVL 175) no aparecen en ningún app.
2. **Los equipos sí emiten esos eventos.** Los 10 equipos Teltonika activos (8 de Transportes Van Oosterwyk, 2 de TransJavier, ninguno demo) mandan AVL 175 y 9 de ellos mandan AVL 246. Quedan guardados como dato crudo en `telemetria_puntos.io_data`, pero nadie los lee: **ni el transportista, ni un admin de Booster, ni on-call se entera**.
3. **Hoy casi todo lo que llega es ruido, no robos.** En 30 días llegaron 419 Towing=1 y 2.244 Auto Geofence. De los Towing, 399 vienen de un solo camión (KZXB64), que reporta ignición apagada en el 100 % de sus puntos en movimiento; son falsos positivos. Las únicas señales "limpias" (8) son de LFGR63 el día en que empezó a reportar (probable instalación). **No hay evidencia de que se haya perdido un robo o remolque real**, pero hoy no habría forma de saberlo.
4. **La alerta `wave2_consumer_stalled["security_p1"]` no puede dispararse** (el topic nunca recibe mensajes, así que `oldest_unacked_message_age` es siempre 0). Además nombra como consumidor a `notification-service` y enlaza un runbook que solo cubre telemetry-processor. Da una falsa sensación de cobertura.
5. **Nadie decidió no notificar estos eventos.** El diseño Wave 2 los ruteaba a `security-p1` ("solo push admin"). La spec `safety-event-fanout` (decisión del PO) cubrió solo crash + unplug + jamming, sin mencionar security-p1. P0-G (2026-06-22) clasificó la suscripción como "huérfana benigna" porque no genera costo. Benigna en costo, sí. Pero es un hueco de producto: el `.cfg` de los equipos activa una función antirrobo que el backend descarta.

---

## 1. Evidencia

Todo verificado el 2026-10-21 (~20:20 UTC) contra `github/main` en `15b8dd3a` y contra el proyecto `booster-ai-494222`. Solo lecturas.

### 1.1 Código

| Afirmación | Evidencia |
|---|---|
| telemetry-processor solo detecta Unplug (252) y Jamming (318) en los records | `apps/telemetry-processor/src/panic-events.ts:23-26` (constantes), `:34-49` (`detectPanicEvents`), `:62-78` (`selectCustomerPanicEvents`), `:85-88` (mapeo a `SafetyEvent`) |
| Crash se publica desde el consumer de `crash-traces` | `apps/telemetry-processor/src/main.ts:231-240` |
| El processor publica a un solo topic: `SAFETY_EVENTS_TOPIC` | `apps/telemetry-processor/src/main.ts:101-107`, `apps/telemetry-processor/src/config.ts:30-35`. No hay variable para security-p1 |
| En infra, ese topic es safety-p0 | `infrastructure/compute.tf:564-565` (`SAFETY_EVENTS_TOPIC = google_pubsub_topic.telemetry_events_safety_p0.name`). El brief citaba ~581; la línea vigente es 565 |
| `routeEvent` y `CHANNEL_TO_PUBSUB_TOPIC` (que sí rutean 246/175 a security-p1) son código muerto en prod | definidos en `packages/shared-schemas/src/avl-ids/event-router.ts:67-72`, `:145`, `:191`. Solo se reexportan (`avl-ids/index.ts:113-114`) y se usan en tests. Comando abajo |
| El contrato del fan-out no admite estos tipos | `packages/shared-schemas/src/domain/safety-event.ts:5`: `z.enum(['crash', 'unplug', 'jamming'])` |
| notification-service solo consume `notification-events-sub` | `apps/notification-service/src/config.ts:10-11`, `apps/notification-service/src/main.ts:47-48` |
| Los IO llegan completos y se guardan sin leerse | `apps/telemetry-processor/src/persist.ts:61-65` (arma `io_data` con todas las entradas) y `:72-90` (INSERT en `telemetria_puntos`). Ya documentado en `.specs/telemetria-fmc150/delta.md:20-23` |
| La suscripción declara un consumidor que no existe | `infrastructure/messaging.tf:14` (comentario "Tow/Auto Geofence → notification"), `:152-163` (topic), `:375-404` (sub pull, label `consumer = "notification-service"` en `:400`) |
| La alerta nombra a notification-service y un runbook ajeno | `infrastructure/telemetry-monitoring.tf:645-651` (`security_p1`), `:699` (documentación, enlaza `oncall-telemetry-incidents.md#telemetry-consumer-stalled`). Esa sección (`docs/runbooks/oncall-telemetry-incidents.md:179`) solo trata `telemetry-events-processor-sub` |

```bash
grep -rn --exclude-dir=node_modules --exclude-dir=dist \
  -E "routeEvent|CHANNEL_TO_PUBSUB_TOPIC|EventChannel|SAFETY_EVENTS_TOPIC|TOWING|AUTO_GEOFENCE|Towing|AutoGeofence|'security-p1'" \
  apps packages --include='*.ts' --include='*.tsx' | grep -v "/test/" | grep -v "\.test\.ts"
# → en apps/ solo aparecen SAFETY_EVENTS_TOPIC (processor config.ts:35, main.ts:104, main.ts:233).
#   routeEvent / CHANNEL_TO_PUBSUB_TOPIC solo en packages/shared-schemas (definición + reexport).

grep -rn --exclude-dir=node_modules --exclude-dir=dist -E "\b(246|175)\b" apps packages --include='*.ts' \
  | grep -v "\.test\.ts" | grep -v "/test/"
# → solo packages/shared-schemas/src/avl-ids/high-panic.ts (catálogo). Ningún app.
```

El código leído es el que corre en prod: la imagen viva del processor es `telemetry-processor:093c0d0b…` (revisión `booster-ai-telemetry-processor-00406-7ss`) y `git diff 093c0d0b 15b8dd3a -- apps/telemetry-processor packages/shared-schemas/src/avl-ids apps/notification-service` sale vacío.

### 1.2 Pub/Sub y Cloud Monitoring

```bash
gcloud pubsub topics list-subscriptions telemetry-events-security-p1 --project=booster-ai-494222
# → una sola: telemetry-events-security-p1-notification-sub

gcloud pubsub subscriptions describe telemetry-events-security-p1-notification-sub --project=booster-ai-494222
# → pushConfig: {} (pull), state: ACTIVE, labels.consumer: notification-service,
#   deadLetterTopic: pubsub-dead-letter, retención 7 días
```

Métricas leídas con la API `monitoring.googleapis.com/v3/projects/booster-ai-494222/timeSeries` (un solo período de alineación igual a la ventana, `ALIGN_SUM` para contadores y `ALIGN_MAX` para gauges). safety-p0 sirve de control: demuestra que la métrica existe y que el processor sí publica.

| Métrica | Ventana | security-p1 | Control safety-p0 |
|---|---|---|---|
| `topic/send_message_operation_count` | 30 días | **0 series** | 365 |
| `topic/send_message_operation_count` | 180 días | **0 series** | 905 (desde 2026-04-24) |
| `topic/send_request_count` | 30 días | **0 series** | — |
| `subscription/num_undelivered_messages` (máx.) | 30 días | 0 | — |
| `subscription/oldest_unacked_message_age` (máx.) | 30 días | 0 | — |
| `subscription/pull_request_count`, `streaming_pull_response_count`, `sent_message_count`, `ack_message_count` | 30 días | **0 series** (nadie hace pull) | — |

Variables de entorno en Cloud Run (prod):

```bash
gcloud run services describe booster-ai-telemetry-processor --region=southamerica-west1 --format=json
# → SAFETY_EVENTS_TOPIC=telemetry-events-safety-p0 (única variable de topic de publicación)
gcloud run services describe booster-ai-notification-service --region=southamerica-west1 --format=json
# → PUBSUB_SUBSCRIPTION_NOTIFICATION_EVENTS=notification-events-sub (única suscripción)
```

Alerta viva:

```bash
gcloud alpha monitoring policies list --project=booster-ai-494222 --filter='displayName:"Wave2 security_p1"'
# → alertPolicies/2949258099903146180, enabled: true, severity: ERROR,
#   documentation: "... Consumer: notification-service (subscription telemetry-events-security-p1-notification-sub) ..."
```

Con el topic vacío, `oldest_unacked_message_age` vale 0 siempre: la alerta está habilitada pero no puede disparar.

### 1.3 Datos de los equipos (Cloud SQL prod, solo SELECT)

Con el helper aprobado `scripts/db/agent-query.sh` (ADR-045, runbook `docs/runbooks/agent-query-prod.md`). En estos equipos el IO 246 y el 175 aparecen **solo** en el record que generó el evento (`io_data ? '246'` coincide con `event_io_id = 246`; igual con 175), así que cada fila es un evento.

**Histórico completo por equipo** (`telemetria_puntos`, ~2,5 M filas):

| IMEI (fin) | Patente | Desde | AVL 246 (eventos) | 246 = 1 | AVL 175 (eventos) | Control 252 | Control 318 |
|---|---|---|---|---|---|---|---|
| …9155 | VFZH-68 | 2026-05-05 | 4 | 2 | 685 | 2 | 225 |
| …0059 | KZXB64 | 2026-07-15 | **2.385** | **1.220** | 939 | 59 | 18 |
| …6730 | PLFL57 | 2026-07-14 | 14 | 7 | 1.058 | 0 | 20 |
| …4284 | KZBB26 | 2026-07-13 | 9 | 5 | 827 | 39 | 30 |
| …8266 | RCPC20 | 2026-07-30 | 0 | 0 | 368 | 75 | 4 |
| …9603 | JWTH77 | 2026-08-19 | 2 | 1 | 458 | 14 | 7 |
| …3278 | JLKT54 | 2026-05-14 | 2 | 1 | 474 | 4 | 18 |
| …5800 | KFKW23 | 2026-08-19 | 2 | 1 | 147 | 53 | 2 |
| …3715 | KWYB30 | 2026-09-25 | 8 | 4 | 253 | 1 | 10 |
| …7450 | LFGR63 | 2026-09-24 | 26 | 13 | 105 | 2 | 2 |

(Un IMEI de prueba `…0875` con 3 filas del 2026-05-03 no aporta eventos.) Los 10 vehículos están `activo` y sus empresas tienen `es_demo = f`.

**Últimos 30 días, por valor e ignición (IO 239):**

| AVL | Valor | Ignición | Eventos | Equipos | Con velocidad > 5 km/h | Velocidad media |
|---|---|---|---|---|---|---|
| 175 | 0 | 0 | 2 | 1 | 2 | 20,0 |
| 175 | 0 | 1 | 329 | 4 | 306 | 21,1 |
| 175 | 1 | 0 | 1.810 | 10 | 0 | 0,0 |
| 175 | 1 | 1 | 103 | 4 | 0 | 0,0 |
| 246 | 0 | 0 | 404 | 5 | 25 | 1,6 |
| 246 | 1 | 0 | 419 | 5 | 331 | 32,3 |

**Últimos 30 días, por equipo**, con un indicador de calidad de la ignición (porcentaje de puntos a más de 10 km/h que reportan ignición apagada):

| Patente | Towing = 1 | …con velocidad > 5 | 175 = 1 | 175 = 0 con ignición | 175 = 0 sin ignición | % movimiento con ignición 0 |
|---|---|---|---|---|---|---|
| KZXB64 | **399** | 325 | 286 | 0 | 0 | **100,0** |
| LFGR63 | 13 | 6 | 104 | 0 | 2 | 1,4 |
| KWYB30 | 4 | 0 | 253 | 0 | 0 | 0,0 |
| PLFL57 | 2 | 0 | 407 | 0 | 0 | 0,0 |
| KZBB26 | 1 | 0 | 291 | 0 | 0 | 0,0 |
| JWTH77 | 0 | 0 | 131 | 131 | 0 | 0,0 |
| KFKW23 | 0 | 0 | 44 | 22 | 0 | 0,0 |
| RCPC20 | 0 | 0 | 98 | 77 | 0 | 0,0 |
| JLKT54 | 0 | 0 | 106 | 99 | 0 | 0,0 |
| VFZH-68 | 0 | 0 | 194 | 0 | 0 | 0,0 |

**Las únicas señales "limpias" del período** (remolque a velocidad o salida de geocerca sin ignición, excluyendo KZXB64) son 8 eventos de LFGR63, todos el 2026-09-24 entre 15:57 y 16:47 (hora de Chile). Es el primer día con datos de ese equipo, así que lo más probable es que fuera la instalación (cableado de ignición aún sin conectar) y no un remolque. No está confirmado.

---

## 2. Impacto

### Qué se pierde hoy

- **Eventos**: Towing (AVL 246: el equipo detecta movimiento con la ignición apagada) y Auto Geofence (AVL 175: el equipo arma una zona al estacionar y avisa al salir de ella). Son las dos funciones antirrobo del FMC150 que activa el `.cfg` Booster (`docs/research/teltonika-fmc150/CONFIGURACION-BOOSTER-DETALLADA.md:155-156`).
- **Equipos**: los 10 equipos Teltonika activos de la flota (tabla 1.3). 9 emiten 246 y los 10 emiten 175.
- **Qué significa "se pierde"**: el dato no se pierde, queda en `telemetria_puntos`. Lo que se pierde es el **aviso**. Ningún componente lo lee y nadie lo recibe: ni el dueño del camión (destinatario del fan-out safety-p0), ni un admin de Booster (destinatario previsto en `event-router.ts:12-13`), ni on-call.
- **Escenario concreto**: un camión estacionado de noche que es remolcado o movido sin encender el motor no genera ninguna notificación. El transportista se entera cuando ve que el camión no está. La única cobertura parcial es indirecta: si el ladrón corta la alimentación salta Unplug (252, safety-p0, sí se notifica). Pero el `.cfg` condiciona Unplug a "ignición ON" (`CONFIGURACION-BOOSTER-DETALLADA.md:153`), así que con el camión apagado puede no dispararse. Esa cobertura no está verificada.

### Calibración: riesgo latente, no incidente

- En los últimos 30 días **no hay evidencia de un robo o remolque real que se haya perdido**. Lo que llegó es casi todo ruido (ver abajo).
- Por lo mismo, **activar el aviso tal cual saturaría al transportista con falsas alarmas**. Con la semántica que tiene el repo, serían unos 1.900 avisos de "salida de geocerca" al mes (cada estacionamiento) más unos 400 "remolques" de KZXB64. Además, esas falsas alarmas llegarían por el mismo canal y la misma plantilla WhatsApp de "Alerta de seguridad" que crash y unplug. El riesgo es entrenar al cliente a ignorar justo el canal P0.

### Monitoreo engañoso

- `wave2_consumer_stalled["security_p1"]` (ERROR) está habilitada, pero con el topic vacío no puede dispararse. Si algún día alguien conecta un publicador sin consumidor, la alerta mandaría a on-call a revisar `notification-service` y una sección de runbook que habla del processor. Ninguno de los dos es el lugar correcto.
- La etiqueta `consumer = notification-service` de la suscripción (`messaging.tf:400`) y el comentario de `messaging.tf:14` repiten el mismo error.

### Hallazgos colaterales (fuera del alcance de este informe, pero condicionan cualquier opción)

1. **KZXB64 no reporta ignición.** En el 100 % de sus 113.282 puntos en movimiento (30 días), el IO 239 vale 0. Por eso cada viaje suyo le parece un remolque al equipo. Probable fuente de ignición mal configurada o cable no conectado. Afecta a cualquier lógica que use ignición, no solo a esta. Se arregla en el equipo (instalador o FOTA), no en el backend.
2. **La semántica del AVL 175 en el repo parece invertida.** `high-panic.ts:20,70` dice `0 = inside, 1 = exited`. Los datos muestran lo contrario: valor 1 con velocidad 0 e ignición apagada (1.913 en 30 días, al estacionar) y valor 0 en movimiento con ignición (329, al partir). Ese patrón calza con `1 = entró / zona armada, 0 = salió`. **No verificado contra el manual de Teltonika**: el wiki del fabricante pidió una verificación anti-bot y no la salté. Hay que confirmarlo antes de implementar cualquier aviso.
3. **La configuración de Auto Geofence parece distinta entre equipos.** 6 de 10 equipos emiten solo valor 1 (nunca 0) en 30 días; los otros 4 emiten ambos. Probablemente difiere el modo de generación del evento (solo entrada vs. entrada y salida). No verificado.
4. **`towingRawSchema = z.literal(1)`** (`high-panic.ts:67`) rechazaría el valor 0 (fin del remolque, 404 eventos en 30 días). Es menor, pero hay que corregirlo si se reutiliza `routeEvent`.

---

## 3. Qué decían el diseño y las decisiones previas

| Fuente | Qué dice |
|---|---|
| `packages/shared-schemas/src/avl-ids/event-router.ts:12-13` | `security-p1`: "eventos de seguridad / antirrobo (Tow, Auto Geofence exit). Solo push admin." |
| `docs/research/teltonika-fmc150/CONFIGURACION-BOOSTER-DETALLADA.md:155-156` | 246 y 175 configurados con prioridad High, operando On Change, canal `security-p1` |
| `infrastructure/messaging.tf:14` | "Wave 2: Tow/Auto Geofence → notification" |
| `.specs/safety-event-fanout/spec.md:18-19` | Decisión del PO: el consumer va en `apps/api`, **no** en notification-service; eventos **crash + unplug + jamming**; destinatario el transportista. **security-p1 no se menciona**, ni dentro ni fuera de alcance |
| `.specs/_followups/P0-G-skeletons-eventos-safety.md:17-20` (2026-06-22) | Las suscripciones pull de security-p1, eco-score y trip-transitions "no tienen productor → backlog cero → benignas". Queda pendiente la decisión del PO de retirarlas |
| `.specs/telemetria-fmc150/mapa-avl.md:40`, `delta.md:77` (2026-07-13) | 246/175 marcados **HUÉRFANO** (presentes en `io_data`, sin consumidor) |
| `infrastructure/compute.tf:592-598` (T10-21) | notification-service ya no es skeleton: consume `notification-events` (WhatsApp/Twilio). Corre "sin DB ni Redis" |
| `docs/adr/` | Ningún ADR trata security-p1 |

**Conclusión**: el canal security-p1 quedó entre dos decisiones. La spec del fan-out se limitó a safety-p0 y P0-G miró las suscripciones huérfanas desde el costo. Nadie volvió a preguntar si el antirrobo debía avisar a alguien.

---

## 4. Opciones

Las tres requieren decisión del PO. Ninguna se ejecuta sin aprobación. Toda la infra se aplica con plan revisado y apply del PO.

### Opción A — Rutearlo por el fan-out que ya funciona (safety-p0 → `apps/api`)

**Qué cambia**:
- Ampliar `safetyEventSchema` con dos tipos nuevos (por ejemplo `towing` y `geofence_exit`) y sus etiquetas en español (`apps/api/src/services/safety-event-labels.ts:8-12`).
- Detectarlos en telemetry-processor, igual que Unplug y Jamming. Solo el record evento (`eventIoId` 246 / 175), solo con ignición apagada y con la semántica de 175 ya verificada.
- Publicar al topic `telemetry-events-safety-p0`. La push subscription OIDC entrega a `POST /internal/safety-events`, que hace push + WhatsApp al dueño del camión.
- Retirar el topic y la suscripción security-p1 y la entrada `security_p1` de la alerta.

**A favor**:
- Reutiliza una tubería en prod y probada: OIDC, DLQ, deduplicación de 600 s por IMEI y tipo (`dispatch-safety-notification.ts:61-63`), métricas y alerta CRITICAL.
- La plantilla WhatsApp `safety_alert_v2` recibe el tipo de evento como variable `{{2}}` (`.specs/safety-event-fanout/whatsapp-template.md:49-52`), así que en principio no hace falta otra aprobación de Meta.
- Respeta la decisión vigente del PO ("consumer en `apps/api`").

**En contra**:
- Mezcla P1 con P0 en el mismo topic, la misma alerta CRITICAL y la misma plantilla "Alerta de seguridad".
- El destinatario pasa a ser el transportista, no "admin" como decía Wave 2.
- **Sin filtros sería ruidoso** (sección 2). Necesita como requisito previo verificar la semántica del 175 y corregir la ignición de KZXB64, o excluir equipos con ignición no confiable.

**Variante A2**: mantener el topic security-p1 separado y convertir su suscripción en push al mismo endpoint, reutilizando el SA `safety-push-invoker`. Así P1 queda separado en la infra y en la alerta, a cambio de algo más de Terraform.

**Esfuerzo**: M (schema + processor + api + tests TDD + Terraform).

### Opción B — Implementarlo en notification-service (diseño Wave 2 original)

**Qué cambia**:
- El processor publica a `telemetry-events-security-p1` (nueva variable de entorno y permiso de publicación).
- notification-service suma una segunda suscripción pull con su handler.
- Hay que resolver vehículo → empresa → destinatarios, deduplicar y enviar push/WhatsApp.

**A favor**:
- Calza con las etiquetas y comentarios existentes.
- Separa P1 de P0 por servicio.

**En contra**:
- **Contradice la decisión fijada en `.specs/safety-event-fanout/spec.md:18`** ("no construir notification-service" para safety). Elegirla requiere un ADR que la reemplace.
- notification-service corre sin DB ni Redis (`compute.tf:597-598`), así que habría que darle acceso a datos y duplicar el ruteo, la deduplicación y el push que ya viven en `apps/api`.
- Mismo problema de ruido que A.

**Esfuerzo**: L.

### Opción C — Apagar el canal y corregir el monitoreo

**Qué cambia**:
- Borrar el topic `telemetry-events-security-p1`, su suscripción y la entrada `security_p1` de `wave2_stall_alerts`.
- Corregir el comentario de `messaging.tf:14` y la documentación de `event-router.ts:12-13`.
- Dejar escrito, en el `.cfg` documentado y aquí, que 246/175 **se guardan pero no se notifican**.

**A favor**:
- Esfuerzo S.
- Elimina una alerta que no puede disparar y una etiqueta que manda a on-call al lugar equivocado.
- No agrega ruido al cliente.
- Es compatible con hacer A más adelante, que usa el topic safety-p0 y no necesita security-p1.

**En contra**:
- Acepta explícitamente que el antirrobo no avisa a nadie. Es una decisión de producto, no técnica.
- Si después se elige A2 o B, habría que recrear el topic.

**Esfuerzo**: S (solo Terraform + docs; apply del PO).

### Recomendación

**C ahora y A como feature aparte, cuando se cumplan sus requisitos previos.**

Motivos:
- Con los datos de hoy, avisar produciría casi solo falsas alarmas por el canal P0.
- La alerta y las etiquetas actuales son engañosas, cuesten lo que cuesten.
- C no cierra la puerta a A.

Requisitos previos de A:
1. Verificar con el manual de Teltonika la semántica del AVL 175.
2. Corregir la fuente de ignición de KZXB64 en el equipo.
3. Que el PO defina destinatario (transportista o admin) y canal (¿mismo template?).

Si el PO considera el antirrobo una promesa de producto hacia los transportistas, conviene ir directo a **A2** con esos tres requisitos como bloqueantes.

### Preguntas para el PO

1. ¿Avisar de remolques y salidas de geocerca es una promesa al transportista, o era solo infraestructura adelantada?
2. Si se avisa: ¿a quién (dueño del camión, admin de Booster o ambos) y por qué canal?
3. ¿Se coordina con el instalador la revisión de la ignición de KZXB64? Hoy deforma este y otros cálculos que usan ignición.

---

## 5. Fuera de alcance

- Los topics `telemetry-events-eco-score` y `telemetry-events-trip-transitions` están en la misma situación (0 publicaciones en 30 días, misma consulta de la sección 1.2). Ya están cubiertos por P0-G; no se reabren aquí.
- Este informe no cambia nada en prod, no toca Terraform y no implementa ninguna opción.
