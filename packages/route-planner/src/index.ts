/**
 * @booster-ai/route-planner
 *
 * La ruta de un camión como datos y funciones puras (ADR-088, spec
 * ruta-parada-servicio): estados, tramos con su masa a bordo, invariantes y
 * las operaciones de agregar, quitar, mover, separar, reordenar y declarar
 * vehículo y conductor. Los services de apps/api
 * cargan la ruta, llaman acá y persisten el resultado.
 */
export const PACKAGE_NAME = '@booster-ai/route-planner' as const;

export * from './tipos.js';
export * from './tramos.js';
export * from './invariantes.js';
export * from './estados.js';
export * from './operaciones.js';
