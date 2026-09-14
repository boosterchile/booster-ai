import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client.js';
import {
  type NumericFieldRule,
  numericFieldError,
  serverValidationFieldsMessage,
  zValidatorIssuePaths,
} from './form-validation.js';

const ENTERO: NumericFieldRule = { min: 1, max: 500, entero: true };
const DECIMAL: NumericFieldRule = { min: -90, max: 90, entero: false };

describe('numericFieldError', () => {
  it('vacío sin requiredMessage → válido (opcional)', () => {
    expect(numericFieldError(ENTERO, '')).toBeNull();
    expect(numericFieldError(ENTERO, '   ')).toBeNull();
  });

  it('vacío con requiredMessage → devuelve el mensaje', () => {
    const rule: NumericFieldRule = { ...ENTERO, requiredMessage: 'Ingresa la capacidad' };
    expect(numericFieldError(rule, '')).toBe('Ingresa la capacidad');
  });

  it('no finito (NaN / Infinity) → "Número inválido"', () => {
    // Vía UI es inalcanzable (sanitización WHATWG), pero la guardia protege
    // callers programáticos: sin ella NaN pasaría los checks de rango.
    expect(numericFieldError(ENTERO, 'abc')).toBe('Número inválido');
    expect(numericFieldError(ENTERO, '1e999')).toBe('Número inválido');
  });

  it('decimal en regla entera → "Debe ser un número entero"', () => {
    expect(numericFieldError(ENTERO, '12.5')).toBe('Debe ser un número entero');
  });

  it('fuera de rango → mensaje con formato es-CL', () => {
    expect(numericFieldError(ENTERO, '10000')).toBe('Debe estar entre 1 y 500');
    expect(numericFieldError({ min: 1, max: 100_000, entero: true }, '200000')).toBe(
      'Debe estar entre 1 y 100.000',
    );
    expect(numericFieldError(DECIMAL, '100')).toBe('Debe estar entre -90 y 90');
  });

  it('decimal válido en regla decimal → null', () => {
    expect(numericFieldError(DECIMAL, '-33.5111')).toBeNull();
  });

  it('bordes inclusivos → null', () => {
    expect(numericFieldError(ENTERO, '1')).toBeNull();
    expect(numericFieldError(ENTERO, '500')).toBeNull();
    expect(numericFieldError(DECIMAL, '-90')).toBeNull();
    expect(numericFieldError(DECIMAL, '90')).toBeNull();
  });
});

function zodPayload(paths: (string | number)[][]): unknown {
  return {
    success: false,
    error: { name: 'ZodError', issues: paths.map((path) => ({ path })) },
  };
}

describe('zValidatorIssuePaths', () => {
  it('ApiError 400 con shape zValidator → paths', () => {
    const err = new ApiError(400, undefined, zodPayload([['latitude'], ['longitude']]));
    expect(zValidatorIssuePaths(err)).toEqual([['latitude'], ['longitude']]);
  });

  it('422 también se acepta (mismo shape en PATCH)', () => {
    const err = new ApiError(422, undefined, zodPayload([['year']]));
    expect(zValidatorIssuePaths(err)).toEqual([['year']]);
  });

  it('Error genérico / status distinto / shape desconocido → null', () => {
    expect(zValidatorIssuePaths(new Error('boom'))).toBeNull();
    expect(zValidatorIssuePaths(new ApiError(500, undefined, zodPayload([['x']])))).toBeNull();
    expect(
      zValidatorIssuePaths(new ApiError(400, 'x', { error: 'plate_already_exists' })),
    ).toBeNull();
  });
});

describe('serverValidationFieldsMessage', () => {
  const LABELS = { latitude: 'Latitud', longitude: 'Longitud' };

  it('nombra los campos conocidos, dedupe incluido', () => {
    const err = new ApiError(
      400,
      undefined,
      zodPayload([['latitude'], ['latitude'], ['longitude']]),
    );
    expect(serverValidationFieldsMessage(err, LABELS)).toBe(
      'Revisa los campos: Latitud, Longitud — el servidor rechazó sus valores.',
    );
  });

  it('ningún path conocido → null (el caller conserva su mensaje)', () => {
    const err = new ApiError(400, undefined, zodPayload([['campo_desconocido']]));
    expect(serverValidationFieldsMessage(err, LABELS)).toBeNull();
  });

  it('shape no zValidator → null', () => {
    expect(serverValidationFieldsMessage(new Error('API error 400'), LABELS)).toBeNull();
  });
});
