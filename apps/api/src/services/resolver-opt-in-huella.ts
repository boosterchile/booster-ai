/**
 * Resolver de opt-in efectivo de medición de huella de carbono para un viaje.
 *
 * Diseño:
 *   - Función pura, sin acceso a base de datos ni dependencias. Recibe los
 *     tres flags ya leídos por el llamador y decide si el viaje mide huella.
 *   - Regla de decisión (spec `.specs/medicion-huella-segmento`, Task 3):
 *       override del viaje  ??  (flag generador  OR  flag transportista)
 *     El override (`trips.carbon_measurement_override`) gana cuando no es
 *     null. Si es null, el viaje hereda el OR de las empresas participantes
 *     consultables, ambas leídas de `empresas.carbon_measurement_enabled`:
 *       · generador  → `trips.generadorCargaEmpresaId` (nullable: drafts
 *         WhatsApp anónimos no tienen empresa generadora)
 *       · transportista → `assignments.empresaId` (solo existe post-asignación)
 *   - Null-safe: empresa ausente o flag null cuenta como `false`. La función
 *     siempre devuelve un boolean, nunca null.
 *   - El consignee NO participa: no es una empresa (solo `consigneeName` /
 *     `consigneeWhatsappE164`, sin FK a `empresas`), por lo tanto no tiene
 *     flag consultable.
 *
 * Supuestos:
 *   - El llamador resuelve los JOINs y pasa `null` cuando la empresa no
 *     existe; esta función no distingue "empresa ausente" de "flag en null".
 *   - Un opt-in efectivo `true` habilita la medición; la degradación por
 *     cobertura baja o peso ausente la deciden tareas posteriores (T12/T13),
 *     no este resolver.
 */

export interface ResolverOptInHuellaInput {
  /** `trips.carbon_measurement_override`; null = heredar de las empresas. */
  tripOverride: boolean | null;
  /** `empresas.carbon_measurement_enabled` del generador; null si no hay empresa generadora. */
  generadorCarbonEnabled: boolean | null;
  /** `empresas.carbon_measurement_enabled` del transportista; null si aún no hay asignación. */
  transportistaCarbonEnabled: boolean | null;
}

export function resolverOptInHuella(input: ResolverOptInHuellaInput): boolean {
  return (
    input.tripOverride ??
    ((input.generadorCarbonEnabled ?? false) || (input.transportistaCarbonEnabled ?? false))
  );
}
