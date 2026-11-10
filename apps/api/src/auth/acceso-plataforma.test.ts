import { describe, expect, it } from 'vitest';
import {
  correoEnListaRespaldo,
  cuentaGestionadaPorBooster,
  tieneAccesoPlataforma,
} from './acceso-plataforma.js';

/**
 * `.specs/acceso-panel-plataforma/spec.md` — T1 (SC1, SC7).
 *
 * Una sola regla de acceso al panel: la cuenta marcada y activa, o el correo
 * de la lista de respaldo. La misma regla decide qué cuentas gestiona solo
 * Booster.
 */

const LISTA = ['dev@boosterchile.com', '  Respaldo@BoosterChile.com '];

describe('tieneAccesoPlataforma (SC1)', () => {
  it.each([
    { marca: true, estado: 'activo', email: 'ana@boosterchile.com', acceso: true },
    { marca: true, estado: 'suspendido', email: 'ana@boosterchile.com', acceso: false },
    { marca: true, estado: 'eliminado', email: 'ana@boosterchile.com', acceso: false },
    { marca: true, estado: 'pendiente_verificacion', email: 'ana@boosterchile.com', acceso: false },
    { marca: false, estado: 'activo', email: 'ana@boosterchile.com', acceso: false },
    { marca: false, estado: 'activo', email: 'dev@boosterchile.com', acceso: true },
    { marca: false, estado: 'pendiente_verificacion', email: 'DEV@boosterchile.com', acceso: true },
    { marca: true, estado: 'suspendido', email: 'dev@boosterchile.com', acceso: true },
  ] as const)(
    'marca=$marca estado=$estado correo=$email → $acceso',
    ({ marca, estado, email, acceso }) => {
      expect(tieneAccesoPlataforma({ isPlatformAdmin: marca, status: estado, email }, LISTA)).toBe(
        acceso,
      );
    },
  );

  it('compara la lista sin mayúsculas ni espacios', () => {
    expect(
      tieneAccesoPlataforma(
        { isPlatformAdmin: false, status: 'activo', email: 'respaldo@boosterchile.com' },
        LISTA,
      ),
    ).toBe(true);
  });

  it('sin correo y sin marca no hay acceso', () => {
    expect(
      tieneAccesoPlataforma({ isPlatformAdmin: false, status: 'activo', email: null }, LISTA),
    ).toBe(false);
    expect(
      tieneAccesoPlataforma({ isPlatformAdmin: false, status: 'activo', email: undefined }, LISTA),
    ).toBe(false);
  });

  it('una marca o un estado ausentes no dan acceso', () => {
    expect(tieneAccesoPlataforma({ email: 'ana@boosterchile.com' }, LISTA)).toBe(false);
    expect(
      tieneAccesoPlataforma({ isPlatformAdmin: true, email: 'ana@boosterchile.com' }, LISTA),
    ).toBe(false);
  });

  it('con la lista vacía decide solo la marca', () => {
    expect(
      tieneAccesoPlataforma(
        { isPlatformAdmin: true, status: 'activo', email: 'dev@boosterchile.com' },
        [],
      ),
    ).toBe(true);
    expect(
      tieneAccesoPlataforma(
        { isPlatformAdmin: false, status: 'activo', email: 'dev@boosterchile.com' },
        [],
      ),
    ).toBe(false);
  });
});

describe('correoEnListaRespaldo', () => {
  it('normaliza ambos lados y descarta entradas vacías', () => {
    expect(correoEnListaRespaldo(' Dev@BoosterChile.com ', LISTA)).toBe(true);
    expect(correoEnListaRespaldo('otra@boosterchile.com', LISTA)).toBe(false);
    expect(correoEnListaRespaldo('', ['', ' '])).toBe(false);
    expect(correoEnListaRespaldo(null, LISTA)).toBe(false);
  });
});

describe('cuentaGestionadaPorBooster (SC7)', () => {
  it('la cuenta marcada la gestiona Booster, aunque esté suspendida', () => {
    expect(
      cuentaGestionadaPorBooster({
        cuenta: { isPlatformAdmin: true, email: 'ana@boosterchile.com' },
        lista: LISTA,
      }),
    ).toBe(true);
  });

  it('la cuenta con un correo de la lista la gestiona Booster', () => {
    expect(
      cuentaGestionadaPorBooster({
        cuenta: { isPlatformAdmin: false, email: 'DEV@boosterchile.com' },
        lista: LISTA,
      }),
    ).toBe(true);
  });

  it('una cuenta de empresa con su correo de empresa la gestiona la empresa', () => {
    expect(
      cuentaGestionadaPorBooster({
        cuenta: { isPlatformAdmin: false, email: 'juan@empresa.cl' },
        lista: LISTA,
      }),
    ).toBe(false);
    expect(cuentaGestionadaPorBooster({ cuenta: null, lista: LISTA })).toBe(false);
  });
});
