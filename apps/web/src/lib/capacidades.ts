import {
  type CapacidadCtx,
  capacidadCtxSchema,
  puedeAceptarOferta,
  puedeAceptarPorVoz,
  puedeAdministrarEmpresa,
  puedeAsignarViaje,
  puedeBorrarEnFlota,
  puedeCancelarCarga,
  puedeGestionarDocumentosTransporte,
  puedeGestionarFlota,
  puedeGestionarSucursales,
  puedeInvitarMiembro,
  puedePedirCobraHoy,
  puedePublicarCarga,
  puedeVerFinanzas,
  puedeVerMenuGestion,
  puedeVerPanelConductor,
} from '@booster-ai/shared-schemas';
import type { MeRegistered } from '../hooks/use-me.js';

/**
 * Contexto de capacidades desde GET /me.
 * `ficha_conductor_mismo_rut` es la señal vigente. Si un cliente cacheó
 * `/me` de antes, `tiene_ficha_conductor` ya es el alias del mismo booleano.
 */
export function ctxDesdeMe(me: MeRegistered): CapacidadCtx | null {
  const active = me.active_membership;
  if (!active?.empresa) {
    return null;
  }
  const ficha =
    me.ficha_conductor_mismo_rut === true ||
    (me.ficha_conductor_mismo_rut == null && me.tiene_ficha_conductor === true);
  const parsed = capacidadCtxSchema.safeParse({
    role: active.role,
    isTransportista: active.empresa.is_transportista === true,
    isGeneradorCarga: active.empresa.is_generador_carga === true,
    fichaConductorMismoRut: ficha,
    puedeAceptarOfertas: active.puede_aceptar_ofertas === true,
  });
  return parsed.success ? parsed.data : null;
}

export interface FlagsCapacidad {
  ctx: CapacidadCtx | null;
  verFinanzas: boolean;
  pedirCobraHoy: boolean;
  aceptarOferta: boolean;
  aceptarPorVoz: boolean;
  asignar: boolean;
  panelConductor: boolean;
  menuGestion: boolean;
  publicarCarga: boolean;
  cancelarCarga: boolean;
  invitar: boolean;
  administrar: boolean;
  gestionarFlota: boolean;
  borrarFlota: boolean;
  documentos: boolean;
  sucursales: boolean;
}

function aplicar(ctx: CapacidadCtx | null, fn: (ctx: CapacidadCtx) => boolean): boolean {
  return ctx !== null && fn(ctx);
}

export function flagsDe(me: MeRegistered): FlagsCapacidad {
  const ctx = ctxDesdeMe(me);
  return {
    ctx,
    verFinanzas: aplicar(ctx, puedeVerFinanzas),
    pedirCobraHoy: aplicar(ctx, puedePedirCobraHoy),
    aceptarOferta: aplicar(ctx, puedeAceptarOferta),
    aceptarPorVoz: aplicar(ctx, puedeAceptarPorVoz),
    asignar: aplicar(ctx, puedeAsignarViaje),
    panelConductor: aplicar(ctx, puedeVerPanelConductor),
    menuGestion: aplicar(ctx, puedeVerMenuGestion),
    publicarCarga: aplicar(ctx, puedePublicarCarga),
    cancelarCarga: aplicar(ctx, puedeCancelarCarga),
    invitar: aplicar(ctx, puedeInvitarMiembro),
    administrar: aplicar(ctx, puedeAdministrarEmpresa),
    gestionarFlota: aplicar(ctx, puedeGestionarFlota),
    borrarFlota: aplicar(ctx, puedeBorrarEnFlota),
    documentos: aplicar(ctx, puedeGestionarDocumentosTransporte),
    sucursales: aplicar(ctx, puedeGestionarSucursales),
  };
}
