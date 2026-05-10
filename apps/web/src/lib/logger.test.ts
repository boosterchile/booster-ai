import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logger', () => {
  it('error con string llama console.error con prefix [web]', () => {
    logger.error('algo falló');
    expect(console.error).toHaveBeenCalledWith('[web]', 'algo falló');
  });

  it('error con context object → llama console.error con context al final', () => {
    logger.error({ err: 'boom' }, 'algo falló');
    expect(console.error).toHaveBeenCalledWith('[web]', 'algo falló', { err: 'boom' });
  });

  it('error con context y sin message → message vacío string', () => {
    logger.error({ err: 'x' });
    expect(console.error).toHaveBeenCalledWith('[web]', '', { err: 'x' });
  });

  it('warn con string', () => {
    logger.warn('cuidado');
    expect(console.warn).toHaveBeenCalledWith('[web]', 'cuidado');
  });

  it('warn con context', () => {
    logger.warn({ k: 1 }, 'msg');
    expect(console.warn).toHaveBeenCalledWith('[web]', 'msg', { k: 1 });
  });

  it('info con string', () => {
    logger.info('hola');
    expect(console.info).toHaveBeenCalledWith('[web]', 'hola');
  });

  it('info con context', () => {
    logger.info({ user: 'felipe' }, 'login ok');
    expect(console.info).toHaveBeenCalledWith('[web]', 'login ok', { user: 'felipe' });
  });
});
