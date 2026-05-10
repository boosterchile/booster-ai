import { describe, expect, it } from 'vitest';
import {
  buildOfferTemplateVariables,
  buildTrackingLinkVariables,
  formatPriceClp,
  regionLabel,
} from './index.js';

describe('regionLabel', () => {
  it('codes conocidos → label legible', () => {
    expect(regionLabel('XIII')).toBe('Metropolitana');
    expect(regionLabel('V')).toBe('Valparaíso');
    expect(regionLabel('IV')).toBe('Coquimbo');
  });

  it('null → em-dash', () => {
    expect(regionLabel(null)).toBe('—');
  });

  it('code desconocido → fallback raw', () => {
    expect(regionLabel('XX')).toBe('XX');
  });
});

describe('formatPriceClp', () => {
  it('formato es-CL con separador de miles', () => {
    expect(formatPriceClp(850000)).toBe('$ 850.000 CLP');
    expect(formatPriceClp(0)).toBe('$ 0 CLP');
  });
});

describe('buildOfferTemplateVariables', () => {
  it('arma 4 vars del template offer_new_v1', () => {
    expect(
      buildOfferTemplateVariables({
        trackingCode: 'BOO-X',
        originRegionCode: 'XIII',
        destinationRegionCode: 'V',
        proposedPriceClp: 850000,
        webAppUrl: 'https://app.boosterchile.com',
      }),
    ).toEqual({
      '1': 'BOO-X',
      '2': 'Metropolitana → Valparaíso',
      '3': '$ 850.000 CLP',
      '4': 'https://app.boosterchile.com/app/ofertas',
    });
  });

  it('strip trailing slash de webAppUrl', () => {
    const vars = buildOfferTemplateVariables({
      trackingCode: 'BOO-X',
      originRegionCode: 'XIII',
      destinationRegionCode: 'V',
      proposedPriceClp: 100,
      webAppUrl: 'https://app.boosterchile.com/',
    });
    expect(vars['4']).toBe('https://app.boosterchile.com/app/ofertas');
  });
});

describe('buildTrackingLinkVariables (Phase 5 PR-L3)', () => {
  it('arma 4 vars con trackingCode, origin, dest, token', () => {
    expect(
      buildTrackingLinkVariables({
        trackingCode: 'BOO-XYZ987',
        originRegionCode: 'XIII',
        destinationRegionCode: 'IV',
        publicTrackingToken: '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).toEqual({
      '1': 'BOO-XYZ987',
      '2': 'Metropolitana',
      '3': 'Coquimbo',
      '4': '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('region null → em-dash; region desconocido → raw fallback', () => {
    const vars = buildTrackingLinkVariables({
      trackingCode: 'BOO-X',
      originRegionCode: null,
      destinationRegionCode: 'XX',
      publicTrackingToken: 'tok',
    });
    expect(vars['2']).toBe('—');
    expect(vars['3']).toBe('XX');
  });

  it('token y trackingCode son variables independientes (no se solapan)', () => {
    const vars = buildTrackingLinkVariables({
      trackingCode: 'BOO-Y',
      originRegionCode: 'V',
      destinationRegionCode: 'VIII',
      publicTrackingToken: 'OPAQUE-UUID-VALUE',
    });
    // {{1}} debe ser tracking_code (legible al usuario), {{4}} debe ser
    // el token opaco (solo para URL).
    expect(vars['1']).toBe('BOO-Y');
    expect(vars['4']).toBe('OPAQUE-UUID-VALUE');
    expect(vars['1']).not.toBe(vars['4']);
  });
});
