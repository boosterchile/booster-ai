# Verify / smoke — chat in-app del viaje

## Automático (CI / local)

```bash
pnpm --filter @booster-ai/api exec vitest run test/unit/chat-route.test.ts
pnpm --filter @booster-ai/web exec vitest run \
  src/hooks/use-chat-stream.test.tsx \
  src/hooks/use-chat-messages.test.tsx \
  src/components/chat/ChatPanel.test.tsx \
  src/routes/conductor.test.tsx \
  src/routes/chat-viaje.test.tsx \
  src/router.test.tsx
pnpm --filter @booster-ai/web exec vitest run src/routes/carga-track.test.tsx src/routes/asignacion-detalle.test.tsx
pnpm --filter @booster-ai/web typecheck
pnpm --filter @booster-ai/api typecheck
pnpm exec biome check apps/api/src/routes/chat.ts apps/web/src/hooks/use-chat-messages.ts \
  apps/web/src/hooks/use-chat-stream.ts apps/web/src/components/chat/ChatPanel.tsx \
  apps/web/src/routes/conductor.tsx apps/web/src/routes/chat-viaje.tsx apps/web/src/router.tsx
```

## Smoke manual (tras deploy; no bloquea el PR)

1. Viaje T2 `asignado`: generador abre chat en `/app/cargas/$id/track`, oficina en
   `/app/asignaciones/$id`, conductor en `/app/conductor` → «Chat con el generador».
2. A escribe texto; B lo ve en &lt; 5 s (punto verde «En vivo» o «Actualizando»).
3. Recogida → assignment `recogido`: ambos lados **siguen** pudiendo escribir.
4. Cortar Redis/Pub/Sub (o DevTools: bloquear `/messages/stream`): el header **no**
   queda en «Reconectando…»; dice «Actualizando» y el refetch trae el mensaje.
5. Entrega: composer desaparece (`readOnly`); GET del historial sigue.
6. Sin `CONTENT_SID_CHAT_UNREAD` / sin WhatsApp del dueño: el chat in-app no se
   degrada. Con template: WA llega como aviso + link a `/app/chat/{assignmentId}`.
