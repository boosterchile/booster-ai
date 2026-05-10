import { describe, expect, it } from 'vitest';
import { healthRouter } from './health.js';

describe('healthRouter', () => {
  it('GET /health responde 200 con status ok y service name', async () => {
    const res = await healthRouter.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('booster-ai-whatsapp-bot');
  });

  it('GET /ready responde 200 con status ready', async () => {
    const res = await healthRouter.request('/ready');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ready');
  });

  it('GET sin path retorna 404', async () => {
    const res = await healthRouter.request('/no-existe');
    expect(res.status).toBe(404);
  });
});
