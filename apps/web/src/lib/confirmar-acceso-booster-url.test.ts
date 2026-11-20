import { describe, expect, it } from 'vitest';
import {
  RUTA_CONFIRMAR_ACCESO_BOOSTER,
  urlConfirmarAccesoBooster,
} from './confirmar-acceso-booster-url.js';

describe('urlConfirmarAccesoBooster', () => {
  it('la pantalla vive bajo /app, con sesión', () => {
    expect(RUTA_CONFIRMAR_ACCESO_BOOSTER).toBe('/app/confirmar-acceso-booster');
  });

  it('arma la dirección absoluta con el origin dado', () => {
    expect(urlConfirmarAccesoBooster('https://app.boosterchile.com')).toBe(
      'https://app.boosterchile.com/app/confirmar-acceso-booster',
    );
  });

  it('usa el origin de la ventana por defecto', () => {
    expect(urlConfirmarAccesoBooster()).toBe(
      `${window.location.origin}/app/confirmar-acceso-booster`,
    );
  });
});
