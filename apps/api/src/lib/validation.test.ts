import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { zValidator as honoZValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zValidator } from './validation.js';

const schema = z.object({ name: z.string().min(1), age: z.number().int() });

function post(app: Hono, body: unknown) {
  return app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('zValidator común', () => {
  it('400 por defecto: { success:false, error:{ issues, name } }', async () => {
    const app = new Hono().post('/', zValidator('json', schema), (c) => c.json({ ok: true }));
    const res = await post(app, { name: '', age: 'x' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: Record<string, unknown> };
    expect(body.success).toBe(false);
    expect(Object.keys(body.error)).toEqual(['issues', 'name']);
    expect(body.error.name).toBe('ZodError');
    expect(Array.isArray(body.error.issues)).toBe(true);
    expect((body.error.issues as unknown[]).length).toBe(2);
  });

  it('el body 400 es byte a byte igual al default de @hono/zod-validator con zod 3', async () => {
    const ours = new Hono().post('/', zValidator('json', schema), (c) => c.json({ ok: true }));
    const lib = new Hono().post('/', honoZValidator('json', schema), (c) => c.json({ ok: true }));
    const input = { name: '', age: 'x', extra: 1 };
    const a = await post(ours, input);
    const b = await post(lib, input);
    expect(a.status).toBe(b.status);
    expect(a.headers.get('content-type')).toBe(b.headers.get('content-type'));
    expect(await a.text()).toBe(await b.text());
  });

  it('input válido pasa y expone c.req.valid', async () => {
    const app = new Hono().post('/', zValidator('json', schema), (c) =>
      c.json(c.req.valid('json')),
    );
    const res = await post(app, { name: 'a', age: 3 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'a', age: 3 });
  });

  it('respeta un hook explícito (passthrough)', async () => {
    const app = new Hono().post(
      '/',
      zValidator('json', schema, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'custom' }, 422);
        }
        return undefined;
      }),
      (c) => c.json({ ok: true }),
    );
    const res = await post(app, {});
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'custom' });
  });

  it('hook explícito que no responde cae al default de la librería (igual que antes)', async () => {
    const app = new Hono().post(
      '/',
      zValidator('json', schema, () => undefined),
      (c) => c.json({ ok: true }),
    );
    const lib = new Hono().post(
      '/',
      honoZValidator('json', schema, () => undefined),
      (c) => c.json({ ok: true }),
    );
    const a = await post(app, {});
    const b = await post(lib, {});
    expect(a.status).toBe(400);
    expect(await a.text()).toBe(await b.text());
  });
});

describe('guard: ninguna ruta importa @hono/zod-validator directo', () => {
  it('src/ solo usa ../lib/validation', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          walk(p);
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          if (p.endsWith(join('lib', 'validation.ts'))) {
            continue;
          }
          if (readFileSync(p, 'utf8').includes("from '@hono/zod-validator'")) {
            offenders.push(p);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
