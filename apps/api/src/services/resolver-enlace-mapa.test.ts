import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { resolverEnlaceMapa } from './resolver-enlace-mapa.js';

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as Logger;

function respuesta(status: number, location?: string): Response {
  const headers = new Headers();
  if (location) {
    headers.set('location', location);
  }
  return new Response(null, { status, headers });
}

describe('resolverEnlaceMapa', () => {
  it('devuelve coordenadas pegadas sin llamar a la red', async () => {
    const fetchImpl = vi.fn();
    const resultado = await resolverEnlaceMapa({
      texto: '-33.45, -70.66',
      fetchImpl,
      logger,
    });
    expect(resultado).toEqual({
      ok: true,
      punto: { latitude: -33.45, longitude: -70.66 },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sigue el link corto de Google Maps hasta el pin', async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta(302, 'https://www.google.com/maps/place/Punto/@-33.4391,-70.6488,17z'),
    );
    const resultado = await resolverEnlaceMapa({
      texto: 'https://maps.app.goo.gl/cFmSSGQDfS2tzWex7',
      fetchImpl,
      logger,
    });
    expect(resultado).toEqual({
      ok: true,
      punto: { latitude: -33.4391, longitude: -70.6488 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('corta la cadena si el redirect sale de Google Maps', async () => {
    const fetchImpl = vi.fn(async () => respuesta(302, 'https://evil.example/robo'));
    const resultado = await resolverEnlaceMapa({
      texto: 'https://maps.app.goo.gl/abcDEF123',
      fetchImpl,
      logger,
    });
    expect(resultado).toEqual({ ok: false, motivo: 'host_no_permitido' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('no sigue un redirect a http ni a una IP', async () => {
    const fetchImpl = vi.fn(async () => respuesta(302, 'http://169.254.169.254/latest'));
    const resultado = await resolverEnlaceMapa({
      texto: 'https://goo.gl/maps/abcDEF123',
      fetchImpl,
      logger,
    });
    expect(resultado).toEqual({ ok: false, motivo: 'host_no_permitido' });
  });

  it('un texto que no es link ni coordenadas no sale a la red', async () => {
    const fetchImpl = vi.fn();
    const resultado = await resolverEnlaceMapa({
      texto: 'Compañía 4425',
      fetchImpl,
      logger,
    });
    expect(resultado).toEqual({ ok: false, motivo: 'url_invalida' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('si el link no redirige a un punto, lo dice', async () => {
    const fetchImpl = vi.fn(async () => respuesta(200));
    const resultado = await resolverEnlaceMapa({
      texto: 'https://maps.app.goo.gl/sinPunto',
      fetchImpl,
      logger,
    });
    expect(resultado).toEqual({ ok: false, motivo: 'sin_coordenadas' });
  });
});
