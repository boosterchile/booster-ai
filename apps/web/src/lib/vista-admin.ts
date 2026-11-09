import { logger } from './logger.js';

/**
 * Doble rol (acceso-usuarios-empresa-panel SC9). Una persona de Booster que
 * también pertenece a una empresa elige, por pestaña, si `/app` la lleva al
 * panel (lo de siempre) o a la web de su empresa.
 *
 * La elección vive en `sessionStorage`. Si el navegador no lo permite (modo
 * privado estricto, almacenamiento bloqueado), la web funciona igual y `/app`
 * sigue yendo al panel.
 */

const CLAVE = 'booster:vista-admin';
const VISTA_EMPRESA = 'empresa';

/** true si en esta pestaña la persona eligió la web de su empresa. */
export function vistaEmpresaElegida(): boolean {
  try {
    return window.sessionStorage.getItem(CLAVE) === VISTA_EMPRESA;
  } catch (err) {
    logger.warn({ err }, 'vista-admin: no se pudo leer la elección; se usa el panel');
    return false;
  }
}

/** «Ir a mi empresa»: `/app` deja de redirigir al panel en esta pestaña. */
export function elegirVistaEmpresa(): void {
  try {
    window.sessionStorage.setItem(CLAVE, VISTA_EMPRESA);
  } catch (err) {
    logger.warn({ err }, 'vista-admin: no se pudo guardar la elección de la empresa');
  }
}

/** «Panel de Booster»: vuelve al comportamiento de siempre. */
export function volverAlPanel(): void {
  try {
    window.sessionStorage.removeItem(CLAVE);
  } catch (err) {
    logger.warn({ err }, 'vista-admin: no se pudo limpiar la elección');
  }
}
