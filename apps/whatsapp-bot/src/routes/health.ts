import { Hono } from 'hono';

export const healthRouter = new Hono();

healthRouter.get('/health', (c) => c.json({ status: 'ok', service: 'booster-ai-whatsapp-bot' }));

// Para este service, health y ready son equivalentes — no tiene deps externas críticas
// al startup (Meta API se usa on-demand, api se chequea en cada request).
healthRouter.get('/ready', (c) => c.json({ status: 'ready' }));
