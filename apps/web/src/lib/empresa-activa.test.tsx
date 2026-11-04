import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setActiveEmpresaId } from './api-client.js';
import {
  SIN_EMPRESA,
  empresaInit,
  empresaKey,
  useActiveEmpresaId,
  useEmpresaScope,
} from './empresa-activa.js';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  setActiveEmpresaId(null);
});

describe('empresaKey', () => {
  it('pone el empresaId después del dominio: dos empresas nunca comparten clave', () => {
    const a = empresaKey('emp-a', 'vehiculos');
    const b = empresaKey('emp-b', 'vehiculos');
    expect(a).toEqual(['vehiculos', 'emp-a']);
    expect(b).toEqual(['vehiculos', 'emp-b']);
    expect(a).not.toEqual(b);
  });

  it('conserva el dominio como primer segmento: las invalidaciones por prefijo siguen matcheando', () => {
    const key = empresaKey('emp-a', 'offers', 'mine', 'pendiente');
    expect(key[0]).toBe('offers');
    expect(key.slice(2)).toEqual(['mine', 'pendiente']);
  });

  it('sin empresa activa usa un marcador explícito, no undefined', () => {
    expect(empresaKey(null, 'cargas')).toEqual(['cargas', SIN_EMPRESA]);
  });
});

describe('empresaInit', () => {
  it('fija X-Empresa-Id al de la clave', () => {
    expect(new Headers(empresaInit('emp-a').headers).get('x-empresa-id')).toBe('emp-a');
  });
  it('sin empresa no agrega header', () => {
    expect(empresaInit(null)).toEqual({});
  });
});

describe('useActiveEmpresaId', () => {
  it('cambia en cuanto setActiveEmpresaId escribe', () => {
    setActiveEmpresaId('emp-a');
    const { result } = renderHook(() => useActiveEmpresaId());
    expect(result.current).toBe('emp-a');
    act(() => {
      setActiveEmpresaId('emp-b');
    });
    expect(result.current).toBe('emp-b');
    act(() => {
      setActiveEmpresaId(null);
    });
    expect(result.current).toBeNull();
  });
});

describe('useEmpresaScope', () => {
  it('clave y header salen del mismo empresaId, y cambian juntos', () => {
    setActiveEmpresaId('emp-a');
    const { result } = renderHook(() => useEmpresaScope());
    expect(result.current.key('vehiculos')).toEqual(['vehiculos', 'emp-a']);
    expect(new Headers(result.current.init.headers).get('x-empresa-id')).toBe('emp-a');
    act(() => {
      setActiveEmpresaId('emp-b');
    });
    expect(result.current.key('vehiculos')).toEqual(['vehiculos', 'emp-b']);
    expect(new Headers(result.current.init.headers).get('x-empresa-id')).toBe('emp-b');
  });
});
