# ADR-016 — Web Push estándar (W3C/VAPID) sobre FCM SDK para notificaciones push

- **Estado**: Accepted
- **Fecha**: 2026-04-30 (decisión); 2026-05-03 (ADR escrito retroactivo)
- **Decisores**: Felipe Vicencio (Product Owner)
- **Supersede**: —

## Contexto

El producto necesita notificaciones push al usuario cuando llegan eventos asíncronos relevantes con la PWA cerrada o en background:

- Mensaje de chat nuevo en `assignment` activo (P3.c)
- Oferta nueva al carrier (B.8)
- Cambio de estado de viaje (futuro)

Booster AI ya tiene Firebase como auth provider (`identitytoolkit.googleapis.com` activo, Firebase Admin SDK en `apps/api`). Lo natural sería usar **Firebase Cloud Messaging (FCM) cliente-side** con el SDK de `firebase/messaging` en el frontend: `getMessaging(app)` + `onMessage(...)` + `getToken({ vapidKey })`. FCM gestiona delivery, retries, token refresh.

La alternativa es la **Web Push API estándar** del W3C: el browser registra una `PushSubscription` con su propio push service (Chrome usa el endpoint FCM `fcm.googleapis.com/wp/...`, Firefox usa Mozilla autopush, Safari usa Apple), el server firma cada push con un JWT VAPID y lo manda al endpoint con un payload encriptado ECDH. Sin SDK de vendor.

## Decisión

Usar **Web Push API estándar W3C** con autenticación VAPID. Implementación:

- **Cliente** (`apps/web/src/lib/web-push.ts` + `apps/web/src/sw.ts`): llama `serviceWorkerRegistration.pushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })`, persiste la subscription contra `POST /me/push-subscription` del api.
- **Server** (`apps/api/src/services/web-push.ts`): usa la lib `web-push` (NPM) que firma el JWT VAPID + encripta el payload con ECDH (p256dh + auth secret del browser). `webpush.sendNotification(subscription, payload)`.
- **Identidad VAPID**: par RSA generado con `npx web-push generate-vapid-keys`, almacenado en Secret Manager (`webpush-vapid-public-key`, `webpush-vapid-private-key`). Subject `mailto:soporte@boosterchile.com`.
- **Persistencia**: tabla `push_subscriptions` (1 row por user × device) — ver `apps/api/src/db/schema.ts:991-1050`. Endpoint, p256dh, auth secret, last_used_at, estado (`activa`/`inactiva`).
- **Service Worker** (`apps/web/src/sw.ts:96-160`): handlers `push` (parsea payload, `showNotification`) y `notificationclick` (deep-link al chat con focus de tab existente o `openWindow`).

## Alternativas consideradas y rechazadas

### A. FCM SDK cliente-side (firebase-messaging)

Importar `firebase/messaging`, llamar `getToken({ vapidKey })`, escuchar con `onMessage`. Server manda push via FCM HTTP v1 API.

- **Por qué se rechazó**:
  - **Vendor lock blando**: el bundle del frontend crece ~50KB con `firebase/messaging`. Si en el futuro se quisiera mover auth fuera de Firebase (ej. Auth0, Clerk), el código de push también requiere migración aunque conceptualmente sean independientes.
  - **No funciona en Safari < 16**: FCM Web no soporta Safari ARN (Apple Push). Web Push estándar sí (a partir de Safari 16.4 nativamente, vía `pushManager.subscribe`). Para una app que apunta a logística chilena con muchos usuarios iOS Safari, esto es crítico.
  - **Token vs subscription**: FCM da un token opaco que el cliente debe rotar manualmente cuando expira (`onTokenRefresh`). Web Push da una subscription completa con endpoint + claves de encriptación; el browser maneja la rotación automáticamente vía `pushsubscriptionchange` event en el SW.
  - **Granularidad de payload**: FCM cliente-side tiene la limitación que `notification` payload se renderiza por el SDK con UI inflexible; para custom rendering hay que mandar `data` payload y manejarlo en `onMessage` (que solo dispara con app abierta) o en el SW. Web Push estándar siempre va al SW, control total.

### B. APNs / Apple Push Notifications directo

Solo iOS, nativo Apple.

- **Por qué se rechazó**: solo cubre Safari/iOS. No cross-platform. Requiere Apple Developer account + cert APNs ($99/año + onboarding). Web Push estándar cubre Safari 16.4+ sin Apple Developer account porque pasa por el endpoint estándar W3C que Apple expone.

### C. Polling agresivo desde el cliente (cada 30s)

Mismo patrón que el listado de ofertas (`/app/ofertas` poll 30s).

- **Por qué se rechazó**: drena batería del mobile, no funciona con app cerrada (que es exactamente el caso de uso del push), genera tráfico continuo al api por usuario sin valor cuando no hay mensajes nuevos. Para chat realtime sí se complementa con SSE (ver ADR-017), pero NO sustituye push para el caso "tab cerrada".

### D. Twilio Notify / Firebase Functions push

Servicios managed sobre los mismos primitives.

- **Por qué se rechazó**: agrega vendor + costo recurrente. La lib `web-push` de NPM es ~50 líneas de uso, sin estado en el server más allá de la tabla `push_subscriptions`. La complejidad de un servicio managed no se justifica para el volumen actual (1 push por mensaje de chat con tab cerrada).

## Consecuencias

### Positivas

- **Cross-browser nativo**: Chrome, Edge, Firefox, Safari 16.4+, Brave, Vivaldi, Samsung Internet. Same código sirve para todos.
- **Sin vendor lock cliente**: el bundle del frontend no importa Firebase Messaging. El cliente solo usa la Web Push API del browser (`pushManager`, `Notification`, `ServiceWorkerRegistration`).
- **Audit trail propio**: cada `sendPushToUser` queda en logs estructurados Pino con `userId`, `assignmentId`, `messageId`, `deliveryResult`. Sin depender del dashboard de FCM.
- **Token rotation transparente**: el browser maneja `pushsubscriptionchange` automáticamente. El cliente re-postea la nueva subscription a `POST /me/push-subscription` y el endpoint upsertea por `endpoint`.
- **Encriptación E2E del payload**: el payload viaja encriptado con ECDH al endpoint del push service. Ni Google (push service de Chrome) ni Mozilla (autopush) pueden leer el contenido. Solo el browser del destinatario tiene la `auth` secret necesaria.
- **Costo operativo**: $0 — todos los push services W3C son free para volúmenes razonables.

### Negativas

- **Sin analytics nativos de delivery**: FCM da dashboard con tasas de entrega/abrir. Acá hay que construirlo desde logs (BigQuery sink ya configurado para `cloudaudit.googleapis.com`, queryable). Para el MVP es overkill construir dashboard; los logs estructurados alcanzan.
- **Manejo manual de errores**: `web-push` no tiene retry automático. La capa `web-push.ts` debe interpretar el status code:
  - 401/403 → VAPID inválido (regenerar keys + actualizar Secret Manager).
  - 410 → subscription revocada (marcar `inactiva` — ya implementado en `apps/api/src/services/web-push.ts`).
  - 413 → payload too large (>4KB encriptado). Acortar `body`.
  - 5xx → push service down (reintentar en job nocturno — pendiente).
- **Permission UX**: el browser muestra el prompt nativo "X quiere mostrarte notificaciones". Conversión típica: 30-50%. UI propia (banner amarillo "Activá las notificaciones…") sube la conversión pidiendo intent antes del prompt nativo.
- **Safari < 16.4**: usuarios de iOS antiguos no reciben push. Mitigación: la lógica de chat tiene fallback WhatsApp (P3.d) — si el push no se puede entregar (subscription inexistente o iOS legacy), se manda WhatsApp template. Cubre el ~5% que queda fuera.

### Riesgos abiertos

- **Job nocturno de retry para 5xx**: hoy un push que falla con 5xx queda perdido. Necesita un Cloud Run Job que escanee logs de los últimos N min y reintente. Backlog explícito.
- **Chat unread fallback** (P3.d, `content_sid_chat_unread`): el cron envía WhatsApp template cuando un mensaje queda sin leer >X min. Hoy se ejecuta solo si el push falla; si el push parece exitoso pero el user nunca ve la notif (notif silenciada en SO), no se gatilla el fallback. Tracking de "notif clicked" via `notificationclick` handler quedaría como métrica futura para refinar el threshold del cron.

## Implementación (estado actual)

| # | Ítem | Archivo | Estado |
|---|------|---------|--------|
| 1 | Secret Manager — VAPID public + private key (placeholders) | `infrastructure/security.tf:172-174` | ✅ aplicado |
| 2 | Env vars `WEBPUSH_VAPID_*` montados en Cloud Run api | `infrastructure/compute.tf:137-138` | ✅ aplicado |
| 3 | Schema Zod para env (todas opcionales — graceful degradation) | `apps/api/src/config.ts:172-178` | ✅ commiteado |
| 4 | `configureWebPush()` idempotente, log warn si VAPID ausente | `apps/api/src/server.ts:86-97` | ✅ commiteado |
| 5 | Tabla `push_subscriptions` (Drizzle) | `apps/api/src/db/schema.ts:991-1050` | ✅ commiteado |
| 6 | Endpoint `POST /me/push-subscription` | `apps/api/src/routes/webpush.ts` | ✅ commiteado |
| 7 | Endpoint `GET /push/vapid-public-key` (retorna la pública para que el cliente subscribe) | `apps/api/src/routes/webpush.ts:137-150` | ✅ commiteado |
| 8 | `sendPushToUser()` con manejo de 410 (soft-delete) | `apps/api/src/services/web-push.ts` | ✅ commiteado |
| 9 | `notifyChatMessageViaPush()` invocado post-INSERT mensaje | `apps/api/src/services/web-push.ts:185+` | ✅ commiteado |
| 10 | Service Worker — `push` + `notificationclick` handlers | `apps/web/src/sw.ts:96-160` | ✅ commiteado |
| 11 | Cliente `lib/web-push.ts` — subscribe + post a api | `apps/web/src/lib/web-push.ts` | ✅ commiteado |
| 12 | Banner UI "Activá notificaciones" en `/app/cargas/:id/track` | `apps/web/src/...` | ✅ commiteado |
| 13 | Cron retry para 5xx en `web-push.ts` | n/a | ⏳ backlog |
| 14 | Métrica "notif clicked" desde SW | n/a | 📅 futuro |

## Referencias

- `apps/api/src/services/web-push.ts` — implementación servidor
- `apps/api/src/routes/webpush.ts` — endpoints subscribe + vapid-public-key
- `apps/api/src/db/schema.ts:983-1050` — tabla `push_subscriptions`
- `apps/web/src/sw.ts` — service worker handlers
- W3C — [Push API specification](https://www.w3.org/TR/push-api/)
- RFC 8292 — [Voluntary Application Server Identification (VAPID) for Web Push](https://datatracker.ietf.org/doc/html/rfc8292)
- RFC 8291 — [Message Encryption for Web Push](https://datatracker.ietf.org/doc/html/rfc8291)
- ADR-017 — SSE para chat realtime (complementario, cubre tab abierta)
- ADR-008 — PWA multirole (contexto del frontend)
