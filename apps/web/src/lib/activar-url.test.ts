import { describe, expect, it } from 'vitest';
import { urlActivar } from './activar-url.js';

describe('urlActivar', () => {
  it('arma la dirección absoluta de /activar con el origin dado', () => {
    expect(urlActivar('https://app.boosterchile.com')).toBe('https://app.boosterchile.com/activar');
  });

  it('usa el origin de la ventana por defecto', () => {
    expect(urlActivar()).toBe(`${window.location.origin}/activar`);
  });
});
