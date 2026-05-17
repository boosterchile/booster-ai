import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { parseEnv } from './parseEnv.js';

describe('parseEnv', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  const schema = z.object({
    NAME: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(8080),
  });

  it('parsea source válido y aplica defaults', () => {
    const env = parseEnv(schema, { NAME: 'svc' });
    expect(env.NAME).toBe('svc');
    expect(env.PORT).toBe(8080);
  });

  it('coerce PORT desde string', () => {
    const env = parseEnv(schema, { NAME: 'svc', PORT: '4000' });
    expect(env.PORT).toBe(4000);
  });

  it('falla con process.exit(1) si missing required', () => {
    expect(() => parseEnv(schema, {})).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('escribe error estructurado JSON a stderr al fallar', () => {
    expect(() => parseEnv(schema, {})).toThrow();
    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(written);
    expect(payload.level).toBe('fatal');
    expect(payload.message).toContain('Invalid environment configuration');
    expect(Array.isArray(payload.errors)).toBe(true);
    expect(payload.errors[0].path).toBe('NAME');
  });

  it('falla si campo coerced es inválido (PORT no-numérico)', () => {
    expect(() => parseEnv(schema, { NAME: 'svc', PORT: 'not-a-number' })).toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('default source = process.env (smoke: parsea con process.env real)', () => {
    const minimal = z.object({
      PATH: z.string().optional(),
    });
    const env = parseEnv(minimal);
    expect(env).toBeDefined();
  });
});
