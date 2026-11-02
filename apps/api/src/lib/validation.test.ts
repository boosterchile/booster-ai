import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zValidator, zodErrorBody } from './validation.js';

const schema = z.object({ name: z.string().min(1), age: z.number().int() });

function post(app: Hono, body: unknown) {
  return app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('zValidator común: mensajes', () => {
  it('usa el mensaje propio del schema', async () => {
    const s = z.object({ a: z.string().min(1, 'Completa este campo') });
    const app = new Hono().post('/', zValidator('json', s), (c) => c.json({ ok: true }));
    const body = (await (await post(app, { a: '' })).json()) as {
      error: { issues: { message: string }[] };
    };
    expect(body.error.issues[0]?.message).toBe('Completa este campo');
  });

  it('ningún issue de formato expone `pattern`; los demás campos quedan', async () => {
    const s = z.object({ email: z.string().email('Ingresa un correo válido') });
    const app = new Hono().post('/', zValidator('json', s), (c) => c.json({ ok: true }));
    const body = (await (await post(app, { email: 'a@b' })).json()) as {
      error: { issues: Record<string, unknown>[] };
    };
    expect(body.error.issues[0]).not.toHaveProperty('pattern');
    expect(body.error.issues[0]).toMatchObject({
      code: 'invalid_format',
      format: 'email',
      message: 'Ingresa un correo válido',
      path: ['email'],
    });
  });

  it('un regex propio tampoco expone `pattern`', async () => {
    const s = z.object({ f: z.string().regex(/^\d{4}$/, 'Usa 4 números') });
    const app = new Hono().post('/', zValidator('json', s), (c) => c.json({ ok: true }));
    const body = (await (await post(app, { f: 'x' })).json()) as {
      error: { issues: Record<string, unknown>[] };
    };
    expect(body.error.issues[0]).not.toHaveProperty('pattern');
    expect(body.error.issues[0]).toMatchObject({
      code: 'invalid_format',
      format: 'regex',
      message: 'Usa 4 números',
    });
  });
});

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

  it('el body 400 es el contrato público, no el default de la librería en zod 4', async () => {
    const app = new Hono().post('/', zValidator('json', schema), (c) => c.json({ ok: true }));
    const res = await post(app, { name: '', age: 'x' });
    const body = (await res.json()) as { error: { issues: { path: unknown[] }[] } };
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(body).toEqual(zodErrorBody(schema.safeParse({ name: '', age: 'x' }).error as never));
    expect(body.error.issues.map((i) => i.path)).toEqual([['name'], ['age']]);
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

  it('hook explícito que no responde cae al body común', async () => {
    const app = new Hono().post(
      '/',
      zValidator('json', schema, () => undefined),
      (c) => c.json({ ok: true }),
    );
    const res = await post(app, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: Record<string, unknown> };
    expect(body.success).toBe(false);
    expect(Object.keys(body.error)).toEqual(['issues', 'name']);
  });
});

// from '…' / from "…" (import y export…from) e import('…') dinámico.
const IMPORT_DIRECTO = /(?:\bfrom\s*|\bimport\s*\(\s*)['"`]@hono\/zod-validator['"`]/;

describe('guard: ninguna ruta importa @hono/zod-validator directo', () => {
  it.each([
    "import { zValidator } from '@hono/zod-validator';",
    'import { zValidator } from "@hono/zod-validator";',
    "const m = await import('@hono/zod-validator');",
    "export { zValidator } from '@hono/zod-validator';",
  ])('detecta %s', (linea) => {
    expect(IMPORT_DIRECTO.test(linea)).toBe(true);
  });

  it('src/ solo usa ../lib/validation', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
        } else if (
          entry.isFile() &&
          /\.tsx?$/.test(entry.name) &&
          !/\.test\.tsx?$/.test(entry.name)
        ) {
          if (p.endsWith(join('lib', 'validation.ts'))) {
            continue;
          }
          if (IMPORT_DIRECTO.test(readFileSync(p, 'utf8'))) {
            offenders.push(p);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
