import { describe, expect, it } from 'vitest';
import {
  type CapacidadCtx,
  esOwnerOperator,
  esSoloLectura,
  mismoRut,
  puedeAceptarOferta,
  puedeAceptarPorVoz,
  puedeAdministrarEmpresa,
  puedeAsignarViaje,
  puedeEjecutarViaje,
  puedeEscribir,
  puedeGestionarDocumentosTransporte,
  puedeGestionarFlota,
  puedeGestionarSucursales,
  puedeInvitarMiembro,
  puedePedirCobraHoy,
  puedePublicarCarga,
  puedeVerFinanzas,
  puedeVerMapaFlota,
  puedeVerMenuGestion,
  puedeVerPanelConductor,
  veSoloSuViaje,
} from './capacidades.js';

/**
 * Matriz rol × capacidad. Datos sintéticos: RUT 11.111.111-1.
 * Las reglas son las confirmadas por Felipe (2026-10-20).
 */
function ctx(over: Partial<CapacidadCtx> = {}): CapacidadCtx {
  return {
    role: 'dueno',
    isTransportista: true,
    isGeneradorCarga: false,
    fichaConductorMismoRut: false,
    puedeAceptarOfertas: false,
    ...over,
  };
}

const DUENO = ctx();
const OWNER_OP = ctx({ fichaConductorMismoRut: true });
const ADMIN = ctx({ role: 'admin' });
const DESPACHADOR = ctx({ role: 'despachador' });
const DESPACHADOR_CON_PERMISO = ctx({ role: 'despachador', puedeAceptarOfertas: true });
const CONDUCTOR = ctx({ role: 'conductor' });
const VISUALIZADOR_T = ctx({ role: 'visualizador' });
const VISUALIZADOR_G = ctx({
  role: 'visualizador',
  isTransportista: false,
  isGeneradorCarga: true,
});
const DUENO_G = ctx({ isTransportista: false, isGeneradorCarga: true });
const DESPACHADOR_G = ctx({
  role: 'despachador',
  isTransportista: false,
  isGeneradorCarga: true,
});

describe('mismo RUT de la ficha', () => {
  it('trata 11.111.111-1 y 11111111-1 como el mismo RUT', () => {
    expect(mismoRut('11.111.111-1', '11111111-1')).toBe(true);
  });

  it('un RUT vacío no coincide', () => {
    expect(mismoRut('11.111.111-1', null)).toBe(false);
    expect(mismoRut('', '11111111-1')).toBe(false);
  });
});

describe('esOwnerOperator', () => {
  it('es dueño con ficha viva del mismo RUT en la empresa activa', () => {
    expect(esOwnerOperator(OWNER_OP)).toBe(true);
  });

  it('el dueño sin ficha, el admin con ficha y el conductor no lo son', () => {
    expect(esOwnerOperator(DUENO)).toBe(false);
    expect(esOwnerOperator(ctx({ role: 'admin', fichaConductorMismoRut: true }))).toBe(false);
    expect(esOwnerOperator(ctx({ role: 'conductor', fichaConductorMismoRut: true }))).toBe(false);
  });
});

describe('matriz de capacidades por rol', () => {
  it('aceptar o rechazar ofertas: dueño y admin siempre; despachador solo con el permiso', () => {
    expect(puedeAceptarOferta(DUENO)).toBe(true);
    expect(puedeAceptarOferta(OWNER_OP)).toBe(true);
    expect(puedeAceptarOferta(ADMIN)).toBe(true);
    expect(puedeAceptarOferta(DESPACHADOR)).toBe(false);
    expect(puedeAceptarOferta(DESPACHADOR_CON_PERMISO)).toBe(true);
    expect(puedeAceptarOferta(CONDUCTOR)).toBe(false);
    expect(puedeAceptarOferta(VISUALIZADOR_T)).toBe(false);
    expect(puedeAceptarOferta(ctx({ role: 'conductor', puedeAceptarOfertas: true }))).toBe(false);
  });

  it('asignar viaje: dueño, admin y despachador de un transportista', () => {
    expect(puedeAsignarViaje(DUENO)).toBe(true);
    expect(puedeAsignarViaje(ADMIN)).toBe(true);
    expect(puedeAsignarViaje(DESPACHADOR)).toBe(true);
    expect(puedeAsignarViaje(CONDUCTOR)).toBe(false);
    expect(puedeAsignarViaje(VISUALIZADOR_T)).toBe(false);
    expect(puedeAsignarViaje(DUENO_G)).toBe(false);
  });

  it('voz: solo el dueño que conduce, en una empresa transportista', () => {
    expect(puedeAceptarPorVoz(OWNER_OP)).toBe(true);
    expect(puedeAceptarPorVoz(DUENO)).toBe(false);
    expect(puedeAceptarPorVoz(ADMIN)).toBe(false);
    expect(puedeAceptarPorVoz(CONDUCTOR)).toBe(false);
  });

  it('panel del conductor: el empleado y el dueño que conduce', () => {
    expect(puedeVerPanelConductor(CONDUCTOR)).toBe(true);
    expect(puedeVerPanelConductor(OWNER_OP)).toBe(true);
    expect(puedeVerPanelConductor(DUENO)).toBe(false);
    expect(puedeVerPanelConductor(DESPACHADOR)).toBe(false);
    expect(puedeVerPanelConductor(VISUALIZADOR_T)).toBe(false);
  });

  it('la plata es solo del dueño y del admin transportista', () => {
    for (const quien of [DUENO, OWNER_OP, ADMIN]) {
      expect(puedeVerFinanzas(quien)).toBe(true);
      expect(puedePedirCobraHoy(quien)).toBe(true);
    }
    for (const quien of [
      DESPACHADOR,
      DESPACHADOR_CON_PERMISO,
      CONDUCTOR,
      VISUALIZADOR_T,
      DUENO_G,
    ]) {
      expect(puedeVerFinanzas(quien)).toBe(false);
      expect(puedePedirCobraHoy(quien)).toBe(false);
    }
  });

  it('el conductor empleado no ve el mapa de la flota; el visualizador sí, en lectura', () => {
    expect(veSoloSuViaje(CONDUCTOR)).toBe(true);
    expect(veSoloSuViaje(OWNER_OP)).toBe(false);
    expect(puedeVerMapaFlota(CONDUCTOR)).toBe(false);
    expect(puedeVerMapaFlota(VISUALIZADOR_T)).toBe(true);
    expect(puedeVerMapaFlota(DESPACHADOR)).toBe(true);
    expect(puedeVerMapaFlota(DUENO)).toBe(true);
    expect(puedeVerMapaFlota(DUENO_G)).toBe(false);
  });

  it('publicar o cancelar una carga: gestor de un generador; el visualizador no', () => {
    expect(puedePublicarCarga(DUENO_G)).toBe(true);
    expect(puedePublicarCarga(DESPACHADOR_G)).toBe(true);
    expect(puedePublicarCarga(VISUALIZADOR_G)).toBe(false);
    expect(
      puedePublicarCarga(ctx({ role: 'admin', isTransportista: false, isGeneradorCarga: true })),
    ).toBe(true);
    expect(puedePublicarCarga(DUENO)).toBe(false);
    expect(puedePublicarCarga(ctx({ role: 'conductor', isGeneradorCarga: true }))).toBe(false);
  });

  it('invitar y administrar la empresa: dueño y admin', () => {
    expect(puedeInvitarMiembro(DUENO)).toBe(true);
    expect(puedeInvitarMiembro(ADMIN)).toBe(true);
    expect(puedeAdministrarEmpresa(DUENO)).toBe(true);
    expect(puedeInvitarMiembro(DESPACHADOR)).toBe(false);
    expect(puedeInvitarMiembro(CONDUCTOR)).toBe(false);
    expect(puedeInvitarMiembro(VISUALIZADOR_T)).toBe(false);
    expect(puedeAdministrarEmpresa(VISUALIZADOR_G)).toBe(false);
  });

  it('el visualizador no escribe; el resto de roles sí puede escribir en su ámbito', () => {
    expect(esSoloLectura(VISUALIZADOR_T)).toBe(true);
    expect(esSoloLectura(VISUALIZADOR_G)).toBe(true);
    expect(puedeEscribir(VISUALIZADOR_T)).toBe(false);
    expect(puedeEscribir(VISUALIZADOR_G)).toBe(false);
    expect(puedeEscribir(DUENO)).toBe(true);
    expect(puedeEscribir(DESPACHADOR)).toBe(true);
    expect(puedeEscribir(CONDUCTOR)).toBe(true);
    expect(puedeGestionarFlota(VISUALIZADOR_T)).toBe(false);
    expect(puedeGestionarFlota(DESPACHADOR)).toBe(true);
    expect(puedeGestionarFlota(CONDUCTOR)).toBe(false);
    expect(puedeGestionarDocumentosTransporte(DESPACHADOR)).toBe(true);
    expect(puedeGestionarDocumentosTransporte(VISUALIZADOR_T)).toBe(false);
    expect(puedeGestionarSucursales(DESPACHADOR_G)).toBe(true);
    expect(puedeGestionarSucursales(VISUALIZADOR_G)).toBe(false);
    expect(puedeGestionarSucursales(DESPACHADOR)).toBe(false);
  });

  it('el menú de gestión no es del conductor empleado', () => {
    expect(puedeVerMenuGestion(CONDUCTOR)).toBe(false);
    expect(puedeVerMenuGestion(OWNER_OP)).toBe(true);
    expect(puedeVerMenuGestion(VISUALIZADOR_T)).toBe(true);
    expect(puedeVerMenuGestion(DESPACHADOR)).toBe(true);
  });

  it('ejecutar el viaje (entrega, incidente, GPS) es solo el usuario asignado', () => {
    expect(puedeEjecutarViaje('user-1', 'user-1')).toBe(true);
    expect(puedeEjecutarViaje('user-1', 'user-2')).toBe(false);
    expect(puedeEjecutarViaje('user-1', null)).toBe(false);
  });
});
