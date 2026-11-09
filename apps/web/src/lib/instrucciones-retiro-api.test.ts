import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api-client.js';
import {
  esArchivoPermitido,
  getInstruccionesRetiro,
  guardarInstruccionesRetiro,
  instruccionesRetiroQueryOptions,
  mensajeErrorInstrucciones,
} from './instrucciones-retiro-api.js';

const RESPUESTA = {
  instrucciones: {
    lugar: 'Bodega Sur',
    nota: 'Andén 4',
    archivo: { mime: 'image/png', url: 'https://signed.example/qr.png' },
    archivo_vencido: false,
    actualizado_en: '2026-11-09T15:00:00Z',
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getInstruccionesRetiro', () => {
  it('pide la ruta del viaje y valida la respuesta', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(RESPUESTA);
    expect(await getInstruccionesRetiro('t-1')).toEqual(RESPUESTA.instrucciones);
    expect(get).toHaveBeenCalledWith('/viajes/t-1/instrucciones-retiro');
  });

  it('404 sin_instrucciones → null', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, 'sin_instrucciones', null));
    expect(await getInstruccionesRetiro('t-1')).toBeNull();
  });

  it('otro error se propaga', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(403, 'forbidden', null));
    await expect(getInstruccionesRetiro('t-1')).rejects.toMatchObject({ status: 403 });
  });

  it('una respuesta con forma inválida falla', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ instrucciones: { lugar: 1 } });
    await expect(getInstruccionesRetiro('t-1')).rejects.toThrow();
  });
});

describe('guardarInstruccionesRetiro', () => {
  it('manda archivo, lugar y nota por PUT multipart', async () => {
    const putForm = vi.spyOn(api, 'putForm').mockResolvedValue(RESPUESTA);
    const qr = new File([new Uint8Array([0x89])], 'qr.png', { type: 'image/png' });
    await guardarInstruccionesRetiro('t-1', { file: qr, lugar: 'Bodega Sur', nota: 'Andén 4' });
    const [ruta, form] = putForm.mock.calls[0] as [string, FormData];
    expect(ruta).toBe('/viajes/t-1/instrucciones-retiro');
    expect(form.get('file')).toBeInstanceOf(File);
    expect(form.get('lugar')).toBe('Bodega Sur');
    expect(form.get('nota')).toBe('Andén 4');
  });

  it('sin archivo no manda el campo file', async () => {
    const putForm = vi.spyOn(api, 'putForm').mockResolvedValue(RESPUESTA);
    await guardarInstruccionesRetiro('t-1', { file: null, lugar: '', nota: 'Andén 4' });
    const [, form] = putForm.mock.calls[0] as [string, FormData];
    expect(form.has('file')).toBe(false);
  });
});

describe('instruccionesRetiroQueryOptions', () => {
  it('renueva la URL firmada antes de que venza (5 min)', () => {
    const opciones = instruccionesRetiroQueryOptions('t-1');
    expect(opciones.queryKey).toEqual(['instrucciones-retiro', 't-1']);
    expect(opciones.refetchInterval).toBeLessThan(5 * 60 * 1000);
    expect(opciones.refetchOnWindowFocus).toBe('always');
  });
});

describe('esArchivoPermitido', () => {
  it('acepta PNG, JPEG y PDF', () => {
    for (const type of ['image/png', 'image/jpeg', 'application/pdf']) {
      expect(esArchivoPermitido(new File(['x'], 'a', { type }))).toEqual({ ok: true });
    }
  });

  it('rechaza otro tipo y un archivo de más de 15 MB', () => {
    expect(esArchivoPermitido(new File(['x'], 'a.txt', { type: 'text/plain' })).ok).toBe(false);
    const grande = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(grande, 'size', { value: 15 * 1024 * 1024 + 1 });
    expect(esArchivoPermitido(grande)).toEqual({
      ok: false,
      mensaje: 'El archivo pesa de más (máximo 15 MB).',
    });
  });
});

describe('mensajeErrorInstrucciones', () => {
  it.each([
    ['instrucciones_vacias', /QR o comprobante, o una nota/],
    ['mime_mismatch', /no sirve/],
    ['mime_not_allowed', /no sirve/],
    ['file_too_large', /15 MB/],
    ['payload_too_large', /15 MB/],
    ['storage_unavailable', /no se pudo guardar/],
    ['upload_failed', /no se pudo guardar/],
    ['read_only', /Tu rol/],
    ['capability_denied', /Tu rol/],
    ['forbidden', /Tu rol/],
    ['invalid_body', /500 caracteres/],
  ])('%s → mensaje propio', (code, esperado) => {
    expect(mensajeErrorInstrucciones(new ApiError(400, code, null))).toMatch(esperado);
  });

  it('cualquier otro error → genérico', () => {
    expect(mensajeErrorInstrucciones(new Error('x'))).toMatch(/No pudimos guardar/);
  });
});
