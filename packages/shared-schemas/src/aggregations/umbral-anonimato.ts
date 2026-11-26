/**
 * Umbral de anonimato único para datos agregados (ADR-096, decisión del PO
 * del 2026-11-25). Un grupo se publica cuando reúne al menos esta cantidad
 * de camiones o de viajes. Lo usan el observatorio, los agregados de
 * organizaciones y los textos de la web: cambiarlo aquí lo cambia en todos.
 *
 * Con 1 el umbral ya no esconde a quién pertenece un grupo pequeño. Lo que
 * protege a una empresa es lo que la respuesta nunca incluye: razón social,
 * patente, conductor ni un viaje individual.
 */
export const UMBRAL_ANONIMATO = 1;
