import { describe, expect, it } from 'vitest';
import {
  buildCoachingTemplateVariables,
  buildOfferTemplateVariables,
  formatPriceClp,
  regionLabel,
  truncate,
} from './index.js';

describe('regionLabel', () => {
  it('mapea código conocido a nombre legible', () => {
    expect(regionLabel('XIII')).toBe('Metropolitana');
    expect(regionLabel('V')).toBe('Valparaíso');
    expect(regionLabel('VI')).toBe("O'Higgins");
  });

  it('devuelve el código crudo si no lo conoce', () => {
    expect(regionLabel('XX')).toBe('XX');
  });

  it('devuelve em-dash si null', () => {
    expect(regionLabel(null)).toBe('—');
  });
});

describe('formatPriceClp', () => {
  it('formatea con separador de miles es-CL', () => {
    expect(formatPriceClp(1500000)).toBe('$ 1.500.000 CLP');
    expect(formatPriceClp(0)).toBe('$ 0 CLP');
  });
});

describe('buildOfferTemplateVariables', () => {
  it('arma 4 variables 1-indexadas con la ruta legible', () => {
    expect(
      buildOfferTemplateVariables({
        trackingCode: 'BST-001',
        originRegionCode: 'XIII',
        destinationRegionCode: 'V',
        proposedPriceClp: 1_500_000,
        webAppUrl: 'https://app.boosterchile.com',
      }),
    ).toEqual({
      '1': 'BST-001',
      '2': 'Metropolitana → Valparaíso',
      '3': '$ 1.500.000 CLP',
      '4': 'https://app.boosterchile.com/app/ofertas',
    });
  });

  it('quita trailing slash del webAppUrl para evitar // en el path', () => {
    const vars = buildOfferTemplateVariables({
      trackingCode: 'BST-001',
      originRegionCode: 'XIII',
      destinationRegionCode: 'V',
      proposedPriceClp: 100,
      webAppUrl: 'https://app.boosterchile.com/',
    });
    expect(vars['4']).toBe('https://app.boosterchile.com/app/ofertas');
  });
});

describe('truncate', () => {
  it('devuelve igual si está bajo el límite', () => {
    expect(truncate('hola mundo', 50)).toBe('hola mundo');
  });

  it('trunca y agrega … sin partir palabras cuando se puede', () => {
    const original = 'Mantén distancia y anticipa frenadas para optimizar consumo';
    const out = truncate(original, 30);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(30);
    // El prefijo (sin "…") debe ser un substring que termina en una palabra
    // completa del original. Verificamos que la próxima posición en el
    // original sea espacio (boundary) y no media palabra.
    const prefix = out.slice(0, -1);
    const idx = prefix.length;
    expect(original.startsWith(prefix)).toBe(true);
    // idx == prefix.length: en el original la siguiente char debería ser
    // ' ' (boundary) — confirmando que no cortamos a mitad.
    expect(original.charAt(idx)).toBe(' ');
  });

  it('si no hay espacio razonable corta hard', () => {
    // 25 chars sin espacio → cae en el branch hard-cut
    expect(truncate('A'.repeat(50), 10)).toBe(`${'A'.repeat(9)}…`);
  });
});

describe('buildCoachingTemplateVariables', () => {
  it('arma 4 variables con score redondeado y nivel mapeado', () => {
    const vars = buildCoachingTemplateVariables({
      trackingCode: 'BST-00421',
      score: 84.7,
      nivel: 'bueno',
      mensaje: 'Buen viaje. Mantén distancia para anticipar frenadas y bajar consumo 5-10%.',
      tripId: 'tr_abc123',
      webAppUrl: 'https://app.boosterchile.com',
    });
    expect(vars).toEqual({
      '1': 'BST-00421',
      '2': '85/100 · Bueno',
      '3': 'Buen viaje. Mantén distancia para anticipar frenadas y bajar consumo 5-10%.',
      '4': 'https://app.boosterchile.com/app/viajes/tr_abc123',
    });
  });

  it('mapea cada nivel canónico a su label español', () => {
    expect(
      buildCoachingTemplateVariables({
        trackingCode: 'X',
        score: 95,
        nivel: 'excelente',
        mensaje: 'm',
        tripId: 't',
        webAppUrl: 'https://x.com',
      })['2'],
    ).toBe('95/100 · Excelente');
    expect(
      buildCoachingTemplateVariables({
        trackingCode: 'X',
        score: 60,
        nivel: 'regular',
        mensaje: 'm',
        tripId: 't',
        webAppUrl: 'https://x.com',
      })['2'],
    ).toBe('60/100 · Regular');
    expect(
      buildCoachingTemplateVariables({
        trackingCode: 'X',
        score: 35,
        nivel: 'malo',
        mensaje: 'm',
        tripId: 't',
        webAppUrl: 'https://x.com',
      })['2'],
    ).toBe('35/100 · Mejorar');
  });

  it('cae a title-case si nivel desconocido', () => {
    const vars = buildCoachingTemplateVariables({
      trackingCode: 'X',
      score: 50,
      nivel: 'nivel-futuro-no-mapeado',
      mensaje: 'm',
      tripId: 't',
      webAppUrl: 'https://x.com',
    });
    expect(vars['2']).toBe('50/100 · Nivel-futuro-no-mapeado');
  });

  it('trunca el mensaje a 280 chars', () => {
    const long = 'x'.repeat(400);
    const vars = buildCoachingTemplateVariables({
      trackingCode: 'X',
      score: 50,
      nivel: 'bueno',
      mensaje: long,
      tripId: 't',
      webAppUrl: 'https://x.com',
    });
    const v3 = vars['3'] ?? '';
    expect(v3.length).toBeLessThanOrEqual(280);
    expect(v3.endsWith('…')).toBe(true);
  });

  it('quita whitespace adyacente del mensaje (Gemini a veces incluye \\n)', () => {
    const vars = buildCoachingTemplateVariables({
      trackingCode: 'X',
      score: 50,
      nivel: 'bueno',
      mensaje: '  hola mundo \n',
      tripId: 't',
      webAppUrl: 'https://x.com',
    });
    expect(vars['3']).toBe('hola mundo');
  });

  it('quita trailing slash de webAppUrl', () => {
    const vars = buildCoachingTemplateVariables({
      trackingCode: 'X',
      score: 50,
      nivel: 'bueno',
      mensaje: 'm',
      tripId: 'tr_zzz',
      webAppUrl: 'https://app.boosterchile.com/',
    });
    expect(vars['4']).toBe('https://app.boosterchile.com/app/viajes/tr_zzz');
  });
});
