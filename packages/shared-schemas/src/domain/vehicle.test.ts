import { describe, expect, it } from 'vitest';
import {
  type VehicleUnitConfigInput,
  bodyTypeSchema,
  esConfiguracionCompatible,
  unitCategorySchema,
  unitTypeSchema,
  validarCoherenciaUnidadVehiculo,
} from './vehicle.js';

describe('unitCategorySchema (D1/ADR-073)', () => {
  it('acepta motriz y arrastre', () => {
    expect(unitCategorySchema.parse('motriz')).toBe('motriz');
    expect(unitCategorySchema.parse('arrastre')).toBe('arrastre');
  });

  it('rechaza valores fuera del enum', () => {
    expect(() => unitCategorySchema.parse('remolcado')).toThrow();
  });
});

describe('unitTypeSchema — whitelist exacta de los 6 subtipos (D4)', () => {
  const EXPECTED = [
    'tracto_camion',
    'camion_rigido',
    'camioneta',
    'furgon',
    'semirremolque',
    'remolque',
  ] as const;

  it('tiene exactamente estos 6 valores, en este orden (espejo del enum SQL tipo_unidad)', () => {
    expect(unitTypeSchema.options).toEqual(EXPECTED);
  });

  it('rechaza el valor legacy con guión bajo (semi_remolque ≠ semirremolque)', () => {
    expect(() => unitTypeSchema.parse('semi_remolque')).toThrow();
  });
});

describe('bodyTypeSchema — whitelist de las 10 carrocerías (D4)', () => {
  it('acepta las 10 carrocerías del DDL 0048', () => {
    for (const v of [
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
    ]) {
      expect(bodyTypeSchema.parse(v)).toBe(v);
    }
  });

  it('rechaza carrocería fuera del enum', () => {
    expect(() => bodyTypeSchema.parse('granelero')).toThrow();
  });
});

describe('validarCoherenciaUnidadVehiculo — espejo runtime de chk_vehiculos_tipo_categoria (D1.2 + D4.5)', () => {
  function build(overrides: Partial<VehicleUnitConfigInput> = {}): VehicleUnitConfigInput {
    return {
      unitCategory: 'motriz',
      unitType: 'camion_rigido',
      capacityKg: 12000,
      curbWeightKg: 8000,
      consumptionLPer100kmBaseline: 25,
      fuelType: 'diesel',
      ...overrides,
    };
  }

  it('motriz camion_rigido con datos completos → coherente ([])', () => {
    expect(validarCoherenciaUnidadVehiculo(build())).toEqual([]);
  });

  it('motriz camion_rigido con curb_weight/consumo/fuel null → sigue coherente (nullable, "como hoy")', () => {
    expect(
      validarCoherenciaUnidadVehiculo(
        build({ curbWeightKg: null, consumptionLPer100kmBaseline: null, fuelType: null }),
      ),
    ).toEqual([]);
  });

  it('tracto_camion con capacity_kg=0 → coherente (D1.2: un tracto no carga solo)', () => {
    expect(
      validarCoherenciaUnidadVehiculo(build({ unitType: 'tracto_camion', capacityKg: 0 })),
    ).toEqual([]);
  });

  it('tracto_camion con capacity_kg negativo → violación capacidad_negativa', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({ unitType: 'tracto_camion', capacityKg: -1 }),
    );
    expect(violations).toEqual([
      expect.objectContaining({ field: 'capacity_kg', code: 'capacidad_negativa' }),
    ]);
  });

  // D4 (decisiones.md línea 30): "tracto_camion → capacity_kg = 0 permitido
  // y consumo requerido". El texto vinculante exige el consumo, a
  // diferencia de curb_weight_kg (que sigue nullable "como hoy" para
  // motriz). Mismo scope que la exigencia de tipo_unidad: aplica a
  // ESCRITURAS nuevas — filas legacy con tipo NULL no pasan por acá.
  it('tracto_camion completo (capacity=0, consumo>0, fuel_type presente) → coherente', () => {
    expect(
      validarCoherenciaUnidadVehiculo(
        build({
          unitType: 'tracto_camion',
          capacityKg: 0,
          consumptionLPer100kmBaseline: 33,
          fuelType: 'diesel',
        }),
      ),
    ).toEqual([]);
  });

  it('tracto_camion sin consumo (null) → violación tracto_consumo_requerido (D4)', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({
        unitType: 'tracto_camion',
        capacityKg: 0,
        consumptionLPer100kmBaseline: null,
      }),
    );
    expect(violations).toEqual([
      expect.objectContaining({
        field: 'consumption_l_per_100km_baseline',
        code: 'tracto_consumo_requerido',
      }),
    ]);
  });

  it('tracto_camion con consumo=0 → misma violación (D4 exige > 0, no solo "presente")', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({
        unitType: 'tracto_camion',
        capacityKg: 0,
        consumptionLPer100kmBaseline: 0,
      }),
    );
    expect(violations).toEqual([
      expect.objectContaining({
        field: 'consumption_l_per_100km_baseline',
        code: 'tracto_consumo_requerido',
      }),
    ]);
  });

  it('tracto_camion sin fuel_type (null) → violación tracto_combustible_requerido (D4)', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({
        unitType: 'tracto_camion',
        capacityKg: 0,
        fuelType: null,
      }),
    );
    expect(violations).toEqual([
      expect.objectContaining({
        field: 'fuel_type',
        code: 'tracto_combustible_requerido',
      }),
    ]);
  });

  it('tracto_camion puede acumular varias violaciones a la vez (capacidad negativa + sin consumo + sin fuel)', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({
        unitType: 'tracto_camion',
        capacityKg: -1,
        consumptionLPer100kmBaseline: null,
        fuelType: null,
      }),
    );
    expect(violations.map((v) => v.field).sort()).toEqual(
      ['capacity_kg', 'consumption_l_per_100km_baseline', 'fuel_type'].sort(),
    );
  });

  it('motriz no-tracto (camioneta) con capacity_kg=0 → violación motriz_capacidad_requerida', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({ unitType: 'camioneta', capacityKg: 0 }),
    );
    expect(violations).toEqual([
      expect.objectContaining({ field: 'capacity_kg', code: 'motriz_capacidad_requerida' }),
    ]);
  });

  it('unit_category=motriz con unit_type=semirremolque → incoherente (espejo del CHECK)', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({ unitCategory: 'motriz', unitType: 'semirremolque' }),
    );
    expect(violations).toEqual([
      expect.objectContaining({ field: 'unit_type', code: 'tipo_categoria_incoherente' }),
    ]);
  });

  it('unit_category=arrastre con unit_type=camion_rigido → incoherente (espejo del CHECK)', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({ unitCategory: 'arrastre', unitType: 'camion_rigido' }),
    );
    expect(violations).toEqual([
      expect.objectContaining({ field: 'unit_type', code: 'tipo_categoria_incoherente' }),
    ]);
  });

  it('arrastre (semirremolque) con capacity>0, curb_weight>0, consumo/fuel null → coherente', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({
        unitCategory: 'arrastre',
        unitType: 'semirremolque',
        capacityKg: 30000,
        curbWeightKg: 7000,
        consumptionLPer100kmBaseline: null,
        fuelType: null,
      }),
    );
    expect(violations).toEqual([]);
  });

  it('arrastre con capacity_kg=0 → violación arrastre_capacidad_requerida', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({
        unitCategory: 'arrastre',
        unitType: 'semirremolque',
        capacityKg: 0,
        curbWeightKg: 7000,
        consumptionLPer100kmBaseline: null,
        fuelType: null,
      }),
    );
    expect(violations).toEqual([
      expect.objectContaining({ field: 'capacity_kg', code: 'arrastre_capacidad_requerida' }),
    ]);
  });

  it('arrastre con curb_weight_kg null → violación arrastre_curb_weight_requerido (D4.5)', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({
        unitCategory: 'arrastre',
        unitType: 'remolque',
        capacityKg: 20000,
        curbWeightKg: null,
        consumptionLPer100kmBaseline: null,
        fuelType: null,
      }),
    );
    expect(violations).toEqual([
      expect.objectContaining({
        field: 'curb_weight_kg',
        code: 'arrastre_curb_weight_requerido',
      }),
    ]);
  });

  it('arrastre con curb_weight_kg=0 → misma violación (D4.5 exige > 0, no solo "presente")', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({
        unitCategory: 'arrastre',
        unitType: 'remolque',
        capacityKg: 20000,
        curbWeightKg: 0,
        consumptionLPer100kmBaseline: null,
        fuelType: null,
      }),
    );
    expect(violations).toEqual([
      expect.objectContaining({
        field: 'curb_weight_kg',
        code: 'arrastre_curb_weight_requerido',
      }),
    ]);
  });

  it('arrastre con consumo no-null → violación arrastre_consumo_debe_ser_null (D4.5)', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({
        unitCategory: 'arrastre',
        unitType: 'semirremolque',
        capacityKg: 20000,
        curbWeightKg: 7000,
        consumptionLPer100kmBaseline: 5,
        fuelType: null,
      }),
    );
    expect(violations).toEqual([
      expect.objectContaining({
        field: 'consumption_l_per_100km_baseline',
        code: 'arrastre_consumo_debe_ser_null',
      }),
    ]);
  });

  it('arrastre con fuel_type no-null → violación arrastre_combustible_debe_ser_null (D4.5)', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({
        unitCategory: 'arrastre',
        unitType: 'semirremolque',
        capacityKg: 20000,
        curbWeightKg: 7000,
        consumptionLPer100kmBaseline: null,
        fuelType: 'diesel',
      }),
    );
    expect(violations).toEqual([
      expect.objectContaining({
        field: 'fuel_type',
        code: 'arrastre_combustible_debe_ser_null',
      }),
    ]);
  });

  it('arrastre puede acumular varias violaciones a la vez', () => {
    const violations = validarCoherenciaUnidadVehiculo(
      build({
        unitCategory: 'arrastre',
        unitType: 'semirremolque',
        capacityKg: 0,
        curbWeightKg: null,
        consumptionLPer100kmBaseline: 5,
        fuelType: 'diesel',
      }),
    );
    expect(violations.map((v) => v.field).sort()).toEqual(
      ['capacity_kg', 'consumption_l_per_100km_baseline', 'curb_weight_kg', 'fuel_type'].sort(),
    );
  });
});

describe('esConfiguracionCompatible — compatibilidad tracto↔semirremolque / rígido↔remolque (D1.3, insumo W4c)', () => {
  it('tracto_camion + semirremolque → compatible', () => {
    expect(esConfiguracionCompatible('tracto_camion', 'semirremolque')).toBe(true);
  });

  it('tracto_camion + remolque → NO compatible', () => {
    expect(esConfiguracionCompatible('tracto_camion', 'remolque')).toBe(false);
  });

  it('camion_rigido + remolque → compatible', () => {
    expect(esConfiguracionCompatible('camion_rigido', 'remolque')).toBe(true);
  });

  it('camion_rigido + semirremolque → NO compatible', () => {
    expect(esConfiguracionCompatible('camion_rigido', 'semirremolque')).toBe(false);
  });

  it('camioneta/furgon no llevan arrastre hoy (D1.3, W4c decide cuándo se habilita)', () => {
    expect(esConfiguracionCompatible('camioneta', 'semirremolque')).toBe(false);
    expect(esConfiguracionCompatible('furgon', 'remolque')).toBe(false);
  });
});
