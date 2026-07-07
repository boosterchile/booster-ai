import { z } from 'zod';
import { chileanPlateSchema } from '../primitives/chile.js';
import { transportistaIdSchema, vehicleIdSchema } from '../primitives/ids.js';

export const vehicleTypeSchema = z.enum([
  'camioneta',
  'furgon_pequeno',
  'furgon_mediano',
  'camion_pequeno',
  'camion_mediano',
  'camion_pesado',
  'semi_remolque',
  'refrigerado',
  'tanque',
]);

export const fuelTypeSchema = z.enum([
  'diesel',
  'gasolina',
  'gas_glp',
  'gas_gnc',
  'electrico',
  'hibrido_diesel',
  'hibrido_gasolina',
  'hidrogeno',
]);

export const vehicleStatusSchema = z.enum(['activo', 'mantenimiento', 'retirado']);

export const vehicleSchema = z.object({
  id: vehicleIdSchema,
  transportista_id: transportistaIdSchema,
  plate: chileanPlateSchema,
  type: vehicleTypeSchema,
  capacity_kg: z.number().int().positive(),
  capacity_m3: z.number().positive(),
  fuel_type: fuelTypeSchema,
  year: z.number().int().min(1990).max(2100),
  brand: z.string().min(1),
  model: z.string().min(1),
  /**
   * Peso en vacío (curb weight) del vehículo en kg. Insumo del
   * carbon-calculator para estimar consumo bajo carga vs base.
   */
  curb_weight_kg: z.number().int().positive(),
  /**
   * Consumo base en litros cada 100 km a carga normal. Base para los
   * cálculos GLEC v3.0 cuando no hay telemetría real (CANbus). Null si
   * el carrier todavía no lo declaró.
   */
  consumption_l_per_100km_baseline: z.number().positive().nullable(),
  teltonika_imei: z.string().optional(),
  last_inspection_at: z.string().datetime().optional(),
  inspection_expires_at: z.string().datetime().optional(),
  status: vehicleStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Vehicle = z.infer<typeof vehicleSchema>;
export type VehicleType = z.infer<typeof vehicleTypeSchema>;
export type FuelType = z.infer<typeof fuelTypeSchema>;
export type VehicleStatus = z.infer<typeof vehicleStatusSchema>;

// =============================================================================
// W4a (migración 0048, ADR-073) — tipologías de flota. `vehicleTypeSchema`
// arriba (9 valores planos) NO cambia de comportamiento: sigue siendo el
// schema legacy que consumen matching-algorithm/cargo-request. Los 3 schemas
// nuevos de acá son ORTOGONALES entre sí y coexisten con el legacy — ver
// decisiones.md D1/D4 y docs/adr/073-tipologias-flota-configuracion-glec.md.
// =============================================================================

/** Motriz (tiene motor propio) vs arrastre (remolcado, sin motor). D1. */
export const unitCategorySchema = z.enum(['motriz', 'arrastre']);
export type UnitCategory = z.infer<typeof unitCategorySchema>;

/**
 * Subtipo dentro de `unitCategory`. Espejo del enum SQL `tipo_unidad`
 * (migración 0048). Nota: `semirremolque` (sin guión bajo) es un valor
 * DISTINTO del legacy `semi_remolque` de `vehicleTypeSchema` — no son
 * intercambiables, cada uno vive en su propia columna/schema.
 */
export const unitTypeSchema = z.enum([
  'tracto_camion',
  'camion_rigido',
  'camioneta',
  'furgon',
  'semirremolque',
  'remolque',
]);
export type UnitType = z.infer<typeof unitTypeSchema>;

/** Carrocería, ortogonal a categoría/tipo. Espejo del enum SQL `tipo_carroceria`. */
export const bodyTypeSchema = z.enum([
  'plano',
  'cortina',
  'furgon_cerrado',
  'refrigerado',
  'tolva',
  'cisterna',
  'portacontenedor',
  'cama_baja',
  'jaula',
  'forestal',
]);
export type BodyType = z.infer<typeof bodyTypeSchema>;

const UNIT_TYPES_ARRASTRE: ReadonlySet<UnitType> = new Set(['semirremolque', 'remolque']);

/** Input de `validarCoherenciaUnidadVehiculo` — subset de campos de un vehículo. */
export interface VehicleUnitConfigInput {
  unitCategory: UnitCategory;
  unitType: UnitType;
  capacityKg: number;
  curbWeightKg: number | null;
  consumptionLPer100kmBaseline: number | null;
  fuelType: FuelType | null;
}

export type VehicleUnitConfigViolationField =
  | 'unit_type'
  | 'capacity_kg'
  | 'curb_weight_kg'
  | 'consumption_l_per_100km_baseline'
  | 'fuel_type';

export interface VehicleUnitConfigViolation {
  field: VehicleUnitConfigViolationField;
  code: string;
  message: string;
}

/**
 * D1.2 + D4.5 — semántica por categoría de unidad, espejo RUNTIME del CHECK
 * `chk_vehiculos_tipo_categoria` (migración 0048) más las reglas que la BD
 * no puede expresar en un CHECK simple (D4.5: `curb_weight_kg` requerido
 * para arrastre; consumo/combustible siempre null para arrastre).
 *
 * Reglas:
 *   - `unit_type` debe ser consistente con `unit_category` (mismo CHECK BD:
 *     arrastre ⟺ unit_type ∈ {semirremolque, remolque}). Si esto falla, el
 *     resto de reglas no se evalúa (no tiene sentido validar capacidad de
 *     una configuración ya incoherente).
 *   - `arrastre`: `capacity_kg > 0`, `curb_weight_kg > 0` REQUERIDO (D4.5,
 *     tara del semi = insumo GVW/GLEC), `consumption_l_per_100km_baseline`
 *     y `fuel_type` SIEMPRE null (un arrastre no tiene motor propio).
 *   - `motriz` + `tracto_camion`: `capacity_kg >= 0` permitido (D1.2, un
 *     tracto no carga solo).
 *   - `motriz` + demás tipos: `capacity_kg > 0`, igual que "como hoy".
 *
 * Devuelve `[]` si la configuración es coherente, o la lista de
 * violaciones (uso típico: `apps/api/src/routes/vehiculos.ts` responde 422
 * ANTES de llegar a la BD si hay ≥1 violación).
 */
export function validarCoherenciaUnidadVehiculo(
  input: VehicleUnitConfigInput,
): VehicleUnitConfigViolation[] {
  const esArrastreCategoria = input.unitCategory === 'arrastre';
  const esArrastreTipo = UNIT_TYPES_ARRASTRE.has(input.unitType);

  if (esArrastreCategoria !== esArrastreTipo) {
    return [
      {
        field: 'unit_type',
        code: 'tipo_categoria_incoherente',
        message: `unit_type '${input.unitType}' incompatible con unit_category '${input.unitCategory}' (espejo de chk_vehiculos_tipo_categoria)`,
      },
    ];
  }

  const violations: VehicleUnitConfigViolation[] = [];

  if (esArrastreCategoria) {
    if (!(input.capacityKg > 0)) {
      violations.push({
        field: 'capacity_kg',
        code: 'arrastre_capacidad_requerida',
        message: 'arrastre requiere capacity_kg > 0',
      });
    }
    if (input.curbWeightKg == null || !(input.curbWeightKg > 0)) {
      violations.push({
        field: 'curb_weight_kg',
        code: 'arrastre_curb_weight_requerido',
        message: 'arrastre requiere curb_weight_kg > 0 (D4.5 — tara del semi es insumo GVW/GLEC)',
      });
    }
    if (input.consumptionLPer100kmBaseline != null) {
      violations.push({
        field: 'consumption_l_per_100km_baseline',
        code: 'arrastre_consumo_debe_ser_null',
        message: 'arrastre no declara consumo propio, siempre null (D4.5)',
      });
    }
    if (input.fuelType != null) {
      violations.push({
        field: 'fuel_type',
        code: 'arrastre_combustible_debe_ser_null',
        message: 'arrastre no declara combustible propio, siempre null (D4.5)',
      });
    }
    return violations;
  }

  // motriz
  if (input.unitType === 'tracto_camion') {
    if (input.capacityKg < 0) {
      violations.push({
        field: 'capacity_kg',
        code: 'capacidad_negativa',
        message: 'capacity_kg no puede ser negativo',
      });
    }
  } else if (!(input.capacityKg > 0)) {
    violations.push({
      field: 'capacity_kg',
      code: 'motriz_capacidad_requerida',
      message: 'capacity_kg debe ser > 0 para unidades motrices no-tracto',
    });
  }

  return violations;
}

/**
 * D1.3 — compatibilidad al armar una configuración de viaje (motriz +
 * arrastre). Regla aprobada: tracto↔semirremolque, rígido↔remolque.
 * `camioneta`/`furgon` no llevan arrastre hoy (el piloto mes 8 no opera
 * esas combinaciones; W4c decide si se habilita más adelante).
 *
 * Insumo de W4c (armado de la configuración efectiva del servicio); esta
 * tarea (W4a) no tiene write path de asignación, solo deja el helper
 * listo + testeado.
 */
export function esConfiguracionCompatible(
  motrizUnitType: UnitType,
  arrastreUnitType: UnitType,
): boolean {
  if (motrizUnitType === 'tracto_camion') {
    return arrastreUnitType === 'semirremolque';
  }
  if (motrizUnitType === 'camion_rigido') {
    return arrastreUnitType === 'remolque';
  }
  return false;
}
