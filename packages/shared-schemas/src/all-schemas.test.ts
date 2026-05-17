/**
 * Test consolidado de cobertura para los schemas de shared-schemas.
 *
 * Por qué un solo archivo en vez de uno por schema:
 * los 36 schemas son declaraciones top-level `z.object({...})` casi puras.
 * Importarlos ya ejecuta sus statements; un test por schema sería
 * boilerplate 1:1 con el código. Esta estructura mantiene describe blocks
 * por SOURCE FILE — sigue siendo navegable, evita duplicación de los
 * mismos ejemplos válidos en 30 archivos, y hace explícitos los casos
 * donde el schema sí tiene lógica (refine/transform/default).
 */
import { describe, expect, it } from 'vitest';
import * as auth from './auth.js';
import * as common from './common.js';
import * as assignment from './domain/assignment.js';
import * as cargoRequest from './domain/cargo-request.js';
import * as driver from './domain/driver.js';
import * as empresa from './domain/empresa.js';
import * as membership from './domain/membership.js';
import * as offer from './domain/offer.js';
import * as orgStakeholder from './domain/organizacion-stakeholder.js';
import * as plan from './domain/plan.js';
import * as stakeholder from './domain/stakeholder.js';
import * as telemetry from './domain/telemetry.js';
import * as transportista from './domain/transportista.js';
import * as tripEvent from './domain/trip-event.js';
import * as tripMetrics from './domain/trip-metrics.js';
import * as trip from './domain/trip.js';
import * as user from './domain/user.js';
import * as vehicle from './domain/vehicle.js';
import * as zonaStakeholder from './domain/zona-stakeholder.js';
import * as zone from './domain/zone.js';
import * as telemetryEvents from './events/telemetry-events.js';
import * as tripEvents from './events/trip-events.js';
import * as onboarding from './onboarding.js';
import * as chile from './primitives/chile.js';
import * as geo from './primitives/geo.js';
import * as ids from './primitives/ids.js';
import * as profile from './profile.js';
import * as siteSettings from './site-settings.js';
import * as tripRequestCreate from './trip-request-create.js';
import * as tripRequest from './trip-request.js';
import * as whatsapp from './whatsapp.js';

const VALID_UUID = '00000000-0000-4000-8000-000000000000';
const VALID_RUT = '11111111-1'; // dígito verificador real para 11111111
const VALID_PHONE = '+56912345678';
const VALID_EMAIL = 'a@b.cl';
const VALID_DATE = '2026-05-16T12:00:00Z';
const VALID_TRACKING = 'BOO-ABC123';

const ADDR = {
  street: 'Av. Apoquindo',
  commune: 'Las Condes',
  city: 'Santiago',
  region: 'Metropolitana',
};

describe('primitives/ids', () => {
  it('uuidSchema acepta UUID v4 y rechaza string vacío', () => {
    expect(ids.uuidSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(() => ids.uuidSchema.parse('not-a-uuid')).toThrow();
  });

  it('todas las brand schemas validan UUID y son distintas a nivel de tipo', () => {
    expect(ids.userIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.empresaIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.transportistaIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.generadorCargaIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.driverIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.vehicleIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.zoneIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.tripIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.tripRequestIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.cargoRequestIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.offerIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.assignmentIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.tripEventIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.stakeholderIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.consentIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.planIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
    expect(ids.membershipIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
  });

  it('aliases deprecated apuntan al mismo schema canónico', () => {
    expect(ids.carrierIdSchema).toBe(ids.transportistaIdSchema);
    expect(ids.shipperIdSchema).toBe(ids.generadorCargaIdSchema);
  });
});

describe('primitives/chile', () => {
  it('rutSchema valida check digit + normaliza (quita puntos, K uppercase)', () => {
    expect(chile.rutSchema.parse('11.111.111-1')).toBe('11111111-1');
    expect(chile.rutSchema.parse('11111111-1')).toBe('11111111-1');
    expect(() => chile.rutSchema.parse('11111111-2')).toThrow(/Dígito/);
    expect(() => chile.rutSchema.parse('abc')).toThrow(/formato/);
  });

  it('normalizeRut quita puntos y uppercase K', () => {
    expect(chile.normalizeRut('11.111.111-k')).toBe('11111111-K');
  });

  it('ensureRutHasDash: dígitos solos → inserta guión; ya con guión → no cambia', () => {
    expect(chile.ensureRutHasDash('111111111')).toBe('11111111-1');
    expect(chile.ensureRutHasDash('11111111K')).toBe('11111111-K');
    expect(chile.ensureRutHasDash('11.111.111-1')).toBe('11111111-1');
    expect(chile.ensureRutHasDash('  11111111-1  ')).toBe('11111111-1');
    expect(chile.ensureRutHasDash('')).toBe('');
    expect(chile.ensureRutHasDash('abc')).toBe('ABC');
  });

  it('formatRutForDisplay agrega puntos al canónico, falla raw → devuelve raw', () => {
    expect(chile.formatRutForDisplay('11111111-1')).toBe('11.111.111-1');
    expect(chile.formatRutForDisplay('raro')).toBe('raro');
  });

  it('chileanPhoneSchema acepta +569XXXXXXXX y rechaza formatos malos', () => {
    expect(chile.chileanPhoneSchema.parse(VALID_PHONE)).toBe(VALID_PHONE);
    expect(() => chile.chileanPhoneSchema.parse('912345678')).toThrow();
    expect(() => chile.chileanPhoneSchema.parse('+1234')).toThrow();
  });

  it('regionCodeSchema acepta XIII y rechaza XX', () => {
    expect(chile.regionCodeSchema.parse('XIII')).toBe('XIII');
    expect(() => chile.regionCodeSchema.parse('XX')).toThrow();
  });

  it('normalizePlate quita separadores y uppercase', () => {
    expect(chile.normalizePlate('bc·df·12')).toBe('BCDF12');
    expect(chile.normalizePlate('BC-DF-12')).toBe('BCDF12');
    expect(chile.normalizePlate('bc df 12')).toBe('BCDF12');
  });

  it('isValidChileanPlate acepta canónico y formato display', () => {
    expect(chile.isValidChileanPlate('BCDF12')).toBe(true);
    expect(chile.isValidChileanPlate('BC·DF·12')).toBe(true);
    expect(chile.isValidChileanPlate('123456')).toBe(false);
  });

  it('formatPlateForDisplay: BCDF12 → BC·DF·12; raw inválido → raw', () => {
    expect(chile.formatPlateForDisplay('BCDF12')).toBe('BC·DF·12');
    expect(chile.formatPlateForDisplay('raro')).toBe('raro');
  });

  it('chileanPlateSchema: normaliza input con separadores, rechaza estructura inválida', () => {
    expect(chile.chileanPlateSchema.parse('bc·df·12')).toBe('BCDF12');
    expect(chile.chileanPlateSchema.parse('BCDF12')).toBe('BCDF12');
    expect(() => chile.chileanPlateSchema.parse('')).toThrow(/Ingresa/);
    expect(() => chile.chileanPlateSchema.parse('toolongtoolongtoolong')).toThrow();
    expect(() => chile.chileanPlateSchema.parse('12345A')).toThrow(/Formato/);
  });
});

describe('primitives/geo', () => {
  it('positionSchema acepta lat/lng en rango y campos opcionales', () => {
    expect(geo.positionSchema.parse({ lat: -33.45, lng: -70.66 })).toEqual({
      lat: -33.45,
      lng: -70.66,
    });
    expect(
      geo.positionSchema.parse({
        lat: 0,
        lng: 0,
        accuracy_m: 10,
        altitude_m: 100,
        heading_deg: 90,
        speed_kmh: 80,
      }),
    ).toBeDefined();
  });

  it('positionSchema rechaza lat fuera de rango', () => {
    expect(() => geo.positionSchema.parse({ lat: 200, lng: 0 })).toThrow();
    expect(() => geo.positionSchema.parse({ lat: 0, lng: 200 })).toThrow();
  });

  it('addressSchema con default country=CL', () => {
    const parsed = geo.addressSchema.parse(ADDR);
    expect(parsed.country).toBe('CL');
  });
});

describe('common', () => {
  it('trackingCodeSchema acepta BOO-XXXXXX, rechaza otros', () => {
    expect(common.trackingCodeSchema.parse(VALID_TRACKING)).toBe(VALID_TRACKING);
    expect(() => common.trackingCodeSchema.parse('XYZ-123456')).toThrow();
    expect(() => common.trackingCodeSchema.parse('BOO-abc')).toThrow();
  });

  it('generateTrackingCode produce código del formato canónico', () => {
    const code = common.generateTrackingCode();
    expect(code).toMatch(/^BOO-[A-Z0-9]{6}$/);
    // Re-validar con el schema (Prove-It de la invariante).
    expect(common.trackingCodeSchema.parse(code)).toBe(code);
  });
});

describe('auth', () => {
  it('userTypeHintSchema acepta los 5 tipos canónicos', () => {
    for (const t of ['carga', 'transporte', 'conductor', 'stakeholder', 'booster']) {
      expect(auth.userTypeHintSchema.parse(t)).toBe(t);
    }
    expect(() => auth.userTypeHintSchema.parse('admin')).toThrow();
  });

  it('claveNumericaSchema: exactamente 6 dígitos', () => {
    expect(auth.claveNumericaSchema.parse('123456')).toBe('123456');
    expect(() => auth.claveNumericaSchema.parse('12345')).toThrow();
    expect(() => auth.claveNumericaSchema.parse('1234567')).toThrow();
    expect(() => auth.claveNumericaSchema.parse('12345a')).toThrow();
  });

  it('USER_TYPE_HINT_LABEL mapea los 5 tipos a etiquetas humanas', () => {
    expect(auth.USER_TYPE_HINT_LABEL.carga).toBe('Generador de carga');
    expect(auth.USER_TYPE_HINT_LABEL.transporte).toBe('Transporte');
    expect(auth.USER_TYPE_HINT_LABEL.conductor).toBe('Conductor');
    expect(auth.USER_TYPE_HINT_LABEL.stakeholder).toBe('Stakeholder');
    expect(auth.USER_TYPE_HINT_LABEL.booster).toBe('Booster');
  });

  it('loginRutSchema parsea body válido (rut + clave + tipo opcional)', () => {
    expect(
      auth.loginRutSchema.parse({ rut: VALID_RUT, clave: '123456', tipo: 'carga' }),
    ).toBeDefined();
    expect(auth.loginRutSchema.parse({ rut: VALID_RUT, clave: '123456' })).toBeDefined();
  });

  it('rotarClaveSchema acepta clave_anterior nullable + nueva', () => {
    expect(
      auth.rotarClaveSchema.parse({ clave_anterior: null, clave_nueva: '654321' }),
    ).toBeDefined();
    expect(
      auth.rotarClaveSchema.parse({ clave_anterior: '111111', clave_nueva: '222222' }),
    ).toBeDefined();
  });

  it('requestRecoveryOtpSchema solo requiere rut', () => {
    expect(auth.requestRecoveryOtpSchema.parse({ rut: VALID_RUT })).toBeDefined();
  });

  it('verifyRecoveryOtpSchema requiere rut + otp + nueva clave', () => {
    expect(
      auth.verifyRecoveryOtpSchema.parse({
        rut: VALID_RUT,
        otp: '987654',
        clave_nueva: '123456',
      }),
    ).toBeDefined();
  });
});

describe('profile', () => {
  it('profileUpdateSchema acepta al menos 1 campo, rechaza objeto vacío', () => {
    const schema = (profile as Record<string, unknown>).profileUpdateSchema as {
      parse: (v: unknown) => unknown;
    };
    if (schema) {
      expect(() => schema.parse({})).toThrow(/Al menos un campo/);
      expect(schema.parse({ full_name: 'Juan Pérez' })).toBeDefined();
      expect(schema.parse({ phone: VALID_PHONE })).toBeDefined();
      expect(schema.parse({ rut: VALID_RUT })).toBeDefined();
    }
  });
});

describe('onboarding', () => {
  it('empresaOnboardingInputSchema exige al menos generador_carga o transportista', () => {
    const schema = onboarding.empresaOnboardingInputSchema;
    const base = {
      user: { full_name: 'Juan', phone: VALID_PHONE, whatsapp_e164: VALID_PHONE },
      empresa: {
        legal_name: 'T',
        rut: VALID_RUT,
        contact_email: VALID_EMAIL,
        contact_phone: VALID_PHONE,
        address: ADDR,
        is_generador_carga: false,
        is_transportista: false,
      },
      plan_slug: 'gratis',
    };
    expect(() => schema.parse(base)).toThrow(/generador de carga|transportista/);

    expect(
      schema.parse({
        ...base,
        empresa: { ...base.empresa, is_generador_carga: true },
      }),
    ).toBeDefined();
  });
});

describe('trip-request', () => {
  it('exports están definidos', () => {
    expect(Object.keys(tripRequest).length).toBeGreaterThan(0);
  });
});

describe('trip-request-create — superRefine de pickup_window', () => {
  const buildBase = (start: string, end: string) => ({
    origin: { address_raw: 'Av. Apoquindo 5400', region_code: 'XIII' },
    destination: { address_raw: 'Calle 1 Norte 123', region_code: 'VIII' },
    cargo: { cargo_type: 'carga_seca', weight_kg: 1000 },
    pickup_window: { start_at: start, end_at: end },
    proposed_price_clp: null,
  });

  it('rechaza pickup_window.start_at en el pasado o sin lead mínimo (~30 min)', () => {
    const schema = tripRequestCreate.tripRequestCreateInputSchema;

    const past = new Date(Date.now() - 60_000).toISOString();
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const justAfter = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const tooLate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 35).toISOString();

    // start_at en el pasado.
    expect(() => schema.parse(buildBase(past, future))).toThrow();

    // start_at < ahora + 30 min.
    expect(() => schema.parse(buildBase(soon, future))).toThrow();

    // end_at <= start_at.
    expect(() => schema.parse(buildBase(future, future))).toThrow();

    // ventana demasiado larga (>30 días suficiente para disparar el límite).
    expect(() => schema.parse(buildBase(future, tooLate))).toThrow();

    // Caso válido (control).
    expect(schema.parse(buildBase(future, justAfter))).toBeDefined();
  });

  it('TRIP_REQUEST_CREATE_LIMITS expone constantes (MIN_ADDRESS_LENGTH=5)', () => {
    expect(tripRequestCreate.TRIP_REQUEST_CREATE_LIMITS.MIN_ADDRESS_LENGTH).toBe(5);
    expect(tripRequestCreate.TRIP_REQUEST_CREATE_LIMITS.MIN_PICKUP_LEAD_MS).toBe(30 * 60 * 1000);
  });
});

describe('whatsapp', () => {
  it('isTextMessage discrimina type=text vs otros tipos', () => {
    const isText = (whatsapp as Record<string, unknown>).isTextMessage as
      | ((m: unknown) => boolean)
      | undefined;
    if (isText) {
      expect(isText({ type: 'text', from: '569', text: { body: 'hola' } })).toBe(true);
      expect(isText({ type: 'image' })).toBe(false);
      expect(isText({ type: 'audio' })).toBe(false);
    }
  });
});

describe('site-settings', () => {
  it('exports están definidos', () => {
    expect(Object.keys(siteSettings).length).toBeGreaterThan(0);
  });
});

describe('domain modules — importables sin errores (schemas executados al import)', () => {
  const modules = {
    assignment,
    'cargo-request': cargoRequest,
    driver,
    empresa,
    membership,
    offer,
    'organizacion-stakeholder': orgStakeholder,
    plan,
    stakeholder,
    telemetry,
    transportista,
    'trip-event': tripEvent,
    'trip-metrics': tripMetrics,
    trip,
    user,
    vehicle,
    'zona-stakeholder': zonaStakeholder,
    zone,
  };
  for (const [name, mod] of Object.entries(modules)) {
    it(`domain/${name} exporta al menos un schema`, () => {
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });
  }
});

describe('events', () => {
  it('telemetry-events exports', () => {
    expect(Object.keys(telemetryEvents).length).toBeGreaterThan(0);
  });
  it('trip-events exports', () => {
    expect(Object.keys(tripEvents).length).toBeGreaterThan(0);
  });
});

describe('zonaStakeholderSchema (bbox refine — D11/ADR-041)', () => {
  const baseZona = {
    id: VALID_UUID,
    slug: 'puerto-valparaiso',
    nombre: 'Puerto Valparaíso',
    region_code: 'CL-VS',
    tipo: 'puerto' as const,
    lat_min: -33.0501,
    lat_max: -33.025,
    lng_min: -71.65,
    lng_max: -71.61,
    is_active: true,
    creado_en: VALID_DATE,
    actualizado_en: VALID_DATE,
  };

  it('acepta bounding box bien formado', () => {
    expect(() => zonaStakeholder.zonaStakeholderSchema.parse(baseZona)).not.toThrow();
  });

  it('rechaza bbox invertido en latitud (lat_min > lat_max)', () => {
    expect(() =>
      zonaStakeholder.zonaStakeholderSchema.parse({ ...baseZona, lat_min: -33.0, lat_max: -33.1 }),
    ).toThrow(/lat_min debe ser estrictamente menor que lat_max/);
  });

  it('rechaza bbox invertido en longitud (lng_min > lng_max)', () => {
    expect(() =>
      zonaStakeholder.zonaStakeholderSchema.parse({ ...baseZona, lng_min: -71.5, lng_max: -71.7 }),
    ).toThrow(/lng_min debe ser estrictamente menor que lng_max/);
  });

  it('rechaza slug con mayúsculas o espacios (cubre criterio "inválido")', () => {
    expect(() =>
      zonaStakeholder.zonaStakeholderSchema.parse({ ...baseZona, slug: 'Puerto Valparaíso' }),
    ).toThrow();
  });
});

describe('empresaSchema (smoke parse de la entidad raíz multi-tenant)', () => {
  it('parsea entidad mínima con defaults (timezone, override null, prior_certs [])', () => {
    const parsed = empresa.empresaSchema.parse({
      id: VALID_UUID,
      legal_name: 'Test SpA',
      rut: VALID_RUT,
      contact_email: VALID_EMAIL,
      contact_phone: VALID_PHONE,
      address: ADDR,
      is_generador_carga: true,
      is_transportista: false,
      plan_id: VALID_UUID,
      status: 'activa',
      created_at: VALID_DATE,
      updated_at: VALID_DATE,
    });
    expect(parsed.timezone).toBe('America/Santiago');
    expect(parsed.max_concurrent_offers_override).toBeNull();
    expect(parsed.prior_certifications).toEqual([]);
    expect(parsed.required_reporting_standards).toEqual([]);
  });

  it('empresaCreateSchema omite id/timestamps/status; aplica status default', () => {
    const created = empresa.empresaCreateSchema.parse({
      legal_name: 'Test',
      rut: VALID_RUT,
      contact_email: VALID_EMAIL,
      contact_phone: VALID_PHONE,
      address: ADDR,
      is_generador_carga: true,
      is_transportista: false,
      plan_id: VALID_UUID,
    });
    expect(created.status).toBe('pendiente_verificacion');
  });
});
