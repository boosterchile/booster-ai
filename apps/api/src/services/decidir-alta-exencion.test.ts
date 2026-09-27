import { describe, expect, it } from 'vitest';
import { decidirAltaExencion } from './decidir-alta-exencion.js';

/**
 * Alta por exención (`.specs/alta-membresia`). El decisor es puro: no toca
 * Firebase ni la base. El rojo de este archivo es el criterio de la fase 1.
 */

describe('decidirAltaExencion', () => {
  it('sin usuario y sin solicitudes → crear y aprobar', () => {
    expect(decidirAltaExencion({ usuarioExiste: false, solicitudes: [] })).toEqual({
      accion: 'crear_y_aprobar',
    });
  });

  it('solo solicitudes rechazadas → crear y aprobar una nueva', () => {
    expect(
      decidirAltaExencion({
        usuarioExiste: false,
        solicitudes: [{ id: 'r1', estado: 'rechazado' }],
      }),
    ).toEqual({ accion: 'crear_y_aprobar' });
  });

  it('correo ya en usuarios → email_already_registered, aunque no haya solicitudes', () => {
    expect(decidirAltaExencion({ usuarioExiste: true, solicitudes: [] })).toEqual({
      accion: 'rechazar',
      codigo: 'email_already_registered',
    });
  });

  it('solicitud aprobada → alta_ya_emitida (no se acuña otro Firebase user)', () => {
    expect(
      decidirAltaExencion({
        usuarioExiste: false,
        solicitudes: [{ id: 'a1', estado: 'aprobado' }],
      }),
    ).toEqual({ accion: 'rechazar', codigo: 'alta_ya_emitida' });
  });

  it('solicitud pendiente → solicitud_pendiente (se aprueba en la lista)', () => {
    expect(
      decidirAltaExencion({
        usuarioExiste: false,
        solicitudes: [{ id: 'p1', estado: 'pendiente_aprobacion' }],
      }),
    ).toEqual({ accion: 'rechazar', codigo: 'solicitud_pendiente' });
  });

  it('aprobada gana sobre pendiente y sobre rechazada', () => {
    expect(
      decidirAltaExencion({
        usuarioExiste: false,
        solicitudes: [
          { id: 'p1', estado: 'pendiente_aprobacion' },
          { id: 'a1', estado: 'aprobado' },
          { id: 'r1', estado: 'rechazado' },
        ],
      }),
    ).toEqual({ accion: 'rechazar', codigo: 'alta_ya_emitida' });
  });

  it('usuario existente gana sobre cualquier solicitud', () => {
    expect(
      decidirAltaExencion({
        usuarioExiste: true,
        solicitudes: [{ id: 'p1', estado: 'pendiente_aprobacion' }],
      }),
    ).toEqual({ accion: 'rechazar', codigo: 'email_already_registered' });
  });
});
