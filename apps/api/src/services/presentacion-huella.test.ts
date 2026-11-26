import { describe, expect, it } from 'vitest';
import { presentacionDesdeMetricas } from './presentacion-huella.js';

/**
 * ADR-091 §1, fila por fila (`.specs/sello-huella-toda-la-web`, criterio 1).
 * La cobertura llega como texto desde `numeric` de Postgres.
 */
describe('presentacionDesdeMetricas', () => {
  const casos: Array<{
    nombre: string;
    m: Parameters<typeof presentacionDesdeMetricas>[0];
    esperada: 'primario' | 'medido_teltonika' | 'estimado';
  }> = [
    {
      nombre: 'primario_verificable con Teltonika → primario',
      m: {
        certificationLevel: 'primario_verificable',
        routeDataSource: 'teltonika_gps',
        coveragePct: '97.50',
      },
      esperada: 'primario',
    },
    {
      nombre: 'primario_verificable sin fuente → primario',
      m: { certificationLevel: 'primario_verificable', routeDataSource: null, coveragePct: null },
      esperada: 'primario',
    },
    {
      nombre: 'secundario_modeled con Teltonika y cobertura ≥ 80 → medido_teltonika',
      m: {
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'teltonika_gps',
        coveragePct: '80.00',
      },
      esperada: 'medido_teltonika',
    },
    {
      nombre: 'secundario_modeled con Teltonika y cobertura bajo 80 → estimado',
      m: {
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'teltonika_gps',
        coveragePct: '79.99',
      },
      esperada: 'estimado',
    },
    {
      nombre: 'secundario_modeled con Google Maps → estimado',
      m: {
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'maps_directions',
        coveragePct: '0',
      },
      esperada: 'estimado',
    },
    {
      nombre: 'secundario_modeled con el móvil → estimado',
      m: {
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'movil_gps',
        coveragePct: '95',
      },
      esperada: 'estimado',
    },
    {
      nombre: 'secundario_default con Teltonika → estimado',
      m: {
        certificationLevel: 'secundario_default',
        routeDataSource: 'teltonika_gps',
        coveragePct: '99',
      },
      esperada: 'estimado',
    },
    {
      nombre: 'nivel ausente → estimado',
      m: { certificationLevel: null, routeDataSource: 'teltonika_gps', coveragePct: '99' },
      esperada: 'estimado',
    },
    {
      nombre: 'secundario_modeled con fuente ausente → estimado',
      m: { certificationLevel: 'secundario_modeled', routeDataSource: null, coveragePct: '99' },
      esperada: 'estimado',
    },
    {
      nombre: 'secundario_modeled con Teltonika y cobertura ausente → estimado',
      m: {
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'teltonika_gps',
        coveragePct: null,
      },
      esperada: 'estimado',
    },
    {
      nombre: 'cobertura no numérica → estimado',
      m: {
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'teltonika_gps',
        coveragePct: 'abc',
      },
      esperada: 'estimado',
    },
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      expect(presentacionDesdeMetricas(caso.m)).toBe(caso.esperada);
    });
  }
});
