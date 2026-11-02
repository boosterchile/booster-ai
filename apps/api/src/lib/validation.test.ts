import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mensajeZod3, zValidator, zodErrorBody } from './validation.js';

const schema = z.object({ name: z.string().min(1), age: z.number().int() });

function post(app: Hono, body: unknown) {
  return app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('zValidator común: textos de zod 3 (D2)', () => {
  it.each([
    [z.object({ a: z.string() }), {}, 'Required'],
    [z.object({ a: z.enum(['x', 'y']) }), {}, 'Required'],
    [z.object({ a: z.string() }), { a: 1 }, 'Expected string, received number'],
    [
      z.object({ a: z.enum(['x', 'y']) }),
      { a: 'z' },
      "Invalid enum value. Expected 'x' | 'y', received 'z'",
    ],
    [z.object({ a: z.string().min(2) }), { a: 'b' }, 'String must contain at least 2 character(s)'],
    [
      z.object({ a: z.array(z.number()).max(1) }),
      { a: [1, 2] },
      'Array must contain at most 1 element(s)',
    ],
    [z.object({ a: z.number().max(5) }), { a: 9 }, 'Number must be less than or equal to 5'],
    [z.object({ a: z.number().gt(0) }), { a: 0 }, 'Number must be greater than 0'],
    [z.object({ a: z.number().lt(5) }), { a: 5 }, 'Number must be less than 5'],
    [z.object({ a: z.string().min(1, 'propio') }), { a: '' }, 'propio'],
    [
      z.object({ a: z.enum(['x', 'y']) }),
      { a: { toString: 'x' } },
      "Expected 'x' | 'y', received object",
    ],
    [z.object({ a: z.enum(['x', 'y']) }), { a: 3 }, "Expected 'x' | 'y', received number"],
    [
      z.object({ a: z.string().length(2) }),
      { a: 'abc' },
      'String must contain exactly 2 character(s)',
    ],
    [
      z.object({ a: z.string().length(2) }),
      { a: 'a' },
      'String must contain exactly 2 character(s)',
    ],
    [z.object({ a: z.number().int() }), { a: 1.5 }, 'Expected integer, received float'],
    [
      z.object({ a: z.enum(['x']) }),
      { a: 'z'.repeat(150) },
      `Invalid enum value. Expected 'x', received '${'z'.repeat(100)}…'`,
    ],
  ])('%#: %j → %s', async (s, input, mensaje) => {
    const app = new Hono().post('/', zValidator('json', s), (c) => c.json({ ok: true }));
    const body = (await (await post(app, input)).json()) as {
      error: { issues: { message: string }[] };
    };
    expect(body.error.issues[0]?.message).toBe(mensaje);
  });
});

describe('mensajeZod3 nunca lanza (nunca 500)', () => {
  it('input con toString no función → 400, no 500', async () => {
    const s = z.object({ a: z.enum(['x', 'y']) });
    const app = new Hono().post('/', zValidator('json', s), (c) => c.json({ ok: true }));
    expect((await post(app, { a: { toString: 'x' } })).status).toBe(400);
  });

  it('si el mapeo falla, cae al default de zod 4 (undefined)', () => {
    const roto = {
      code: 'invalid_value',
      get values(): unknown {
        throw new Error('x');
      },
    };
    expect(mensajeZod3(roto as never)).toBeUndefined();
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
    expect(body).toEqual(
      zodErrorBody(schema.safeParse({ name: '', age: 'x' }, { error: mensajeZod3 }).error as never),
    );
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
