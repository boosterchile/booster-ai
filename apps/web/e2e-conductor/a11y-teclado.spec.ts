import { expect, test } from '@playwright/test';
import { expectTeclado } from './a11y.js';

/**
 * La revisión de teclado toma una foto de los controles y después recorre la
 * pantalla con Tab. Un widget de terceros puede cambiar el DOM entre las dos
 * cosas: el mapa de Google, con la clave de CI, monta su contenedor enfocable
 * y lo reemplaza por su pantalla de error. Ese contenedor quedaba en la foto,
 * ya no existía al recorrer, y la revisión lo daba por «sin alcanzar» de forma
 * intermitente (runs 42997030576 y 43013395001).
 *
 * Estos tests no usan la aplicación: arman la página a mano para fijar el
 * comportamiento de la revisión misma.
 */
const PAGINA = (extra: string) => `<!doctype html>
<html lang="es">
  <head><title>Revisión de teclado</title></head>
  <body>
    <main>
      <button type="button" id="primero">Primero</button>
      ${extra}
      <button type="button" id="ultimo">Último</button>
    </main>
  </body>
</html>`;

/** Un contenedor enfocable, como el del mapa, que cambia al primer Tab. */
const WIDGET = (alPrimerTab: string) => `
  <div id="mapa" tabindex="0" aria-label="Map" style="width:200px;height:100px">mapa</div>
  <script>
    document.addEventListener(
      'keydown',
      () => { const mapa = document.getElementById('mapa'); ${alPrimerTab} },
      { once: true, capture: true },
    );
  </script>`;

test.describe('revisión de teclado ante un control que cambia durante el recorrido', () => {
  test('un control que se quita del documento no cuenta como sin alcanzar', async ({ page }) => {
    await page.setContent(PAGINA(WIDGET('mapa.remove();')));
    await expectTeclado(page, 'página de prueba');
    await expect(page.locator('#mapa')).toHaveCount(0);
  });

  test('un control que deja de mostrarse tampoco', async ({ page }) => {
    await page.setContent(PAGINA(WIDGET("mapa.style.display = 'none';")));
    await expectTeclado(page, 'página de prueba');
  });

  test('un control que deja de ser enfocable tampoco', async ({ page }) => {
    await page.setContent(PAGINA(WIDGET("mapa.removeAttribute('tabindex');")));
    await expectTeclado(page, 'página de prueba');
  });

  test('sin cambios en el documento, todos los controles se alcanzan', async ({ page }) => {
    await page.setContent(
      PAGINA('<div tabindex="0" aria-label="Map" style="width:200px;height:100px">mapa</div>'),
    );
    await expectTeclado(page, 'página de prueba');
  });

  test('un control que sigue en pantalla y no se alcanza sigue siendo un fallo', async ({
    page,
  }) => {
    // Se espera que falle: el primer botón retiene el foco y el resto queda
    // fuera del alcance del teclado.
    test.fail();
    await page.setContent(
      PAGINA(`<script>
        document.getElementById('primero').addEventListener('keydown', (e) => {
          if (e.key === 'Tab') { e.preventDefault(); }
        });
      </script>`),
    );
    await expectTeclado(page, 'página de prueba');
  });
});
