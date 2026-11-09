import {
  type CapacidadCtx,
  capacidadCtxSchema,
  esGestor,
  esSoloLectura,
  puedeAceptarOferta,
  puedeAdministrarEmpresa,
  puedeAsignarViaje,
  puedeEditarCarga,
  puedeGestionarFlota,
  puedeGestionarSucursales,
  puedeInvitarMiembro,
  puedePublicarCarga,
  puedeResponderCambioCarga,
  puedeVerFinanzas,
  veSoloSuViaje,
} from '@booster-ai/shared-schemas';
import type { Context } from 'hono';

/**
 * Arma el contexto de capacidades desde la membresía activa.
 * Si el rol no es uno del schema, o falta la membresía, devuelve null:
 * el caller niega. Los stubs viejos que aplanan `{ role, empresa }` sin
 * `membership` también caen en null y no agregan filtros.
 */
export function ctxDeUserContext(
  userContext:
    | {
        activeMembership?: {
          membership?: { role?: unknown; puedeAceptarOfertas?: unknown } | null;
          empresa?: { isTransportista?: unknown; isGeneradorCarga?: unknown } | null;
        } | null;
      }
    | null
    | undefined,
  extra?: { fichaConductorMismoRut?: boolean },
): CapacidadCtx | null {
  const active = userContext?.activeMembership;
  if (!active?.membership || !active.empresa) {
    return null;
  }
  const parsed = capacidadCtxSchema.safeParse({
    role: active.membership.role,
    isTransportista: active.empresa.isTransportista === true,
    isGeneradorCarga: active.empresa.isGeneradorCarga === true,
    fichaConductorMismoRut: extra?.fichaConductorMismoRut === true,
    puedeAceptarOfertas: active.membership.puedeAceptarOfertas === true,
  });
  return parsed.success ? parsed.data : null;
}

export function denegarFinanzas(c: Context, userContext: unknown): Response | null {
  const ctx = ctxDeUserContext(userContext as Parameters<typeof ctxDeUserContext>[0]);
  if (ctx && puedeVerFinanzas(ctx)) {
    return null;
  }
  return c.json(
    { error: 'forbidden', code: 'capability_denied', capability: 'puedeVerFinanzas' },
    403,
  );
}

export function denegarAceptarOferta(c: Context, userContext: unknown): Response | null {
  const ctx = ctxDeUserContext(userContext as Parameters<typeof ctxDeUserContext>[0]);
  if (ctx && puedeAceptarOferta(ctx)) {
    return null;
  }
  return c.json(
    { error: 'forbidden', code: 'capability_denied', capability: 'puedeAceptarOferta' },
    403,
  );
}

/** editar-anular-cargas §6. Visualizador: `read_only`; otro rol: `capability_denied`. */
export function denegarEditarCarga(c: Context, userContext: unknown): Response | null {
  const ctx = ctxDeUserContext(userContext as Parameters<typeof ctxDeUserContext>[0]);
  if (ctx && puedeEditarCarga(ctx)) {
    return null;
  }
  if (ctx && esSoloLectura(ctx)) {
    return c.json({ error: 'forbidden', code: 'read_only' }, 403);
  }
  return c.json(
    { error: 'forbidden', code: 'capability_denied', capability: 'puedeEditarCarga' },
    403,
  );
}

/**
 * editar-anular-cargas §6: aceptar o rechazar un cambio de carga.
 * `requireCarrierAuth` no mira el rol, así que este chequeo es obligatorio.
 */
export function denegarResponderCambioCarga(c: Context, userContext: unknown): Response | null {
  const ctx = ctxDeUserContext(userContext as Parameters<typeof ctxDeUserContext>[0]);
  if (ctx && puedeResponderCambioCarga(ctx)) {
    return null;
  }
  return c.json(
    { error: 'forbidden', code: 'capability_denied', capability: 'puedeResponderCambioCarga' },
    403,
  );
}

/** Visualizador: `read_only`. Otro rol sin permiso de publicar: `capability_denied`. */
export function denegarPublicarCarga(c: Context, userContext: unknown): Response | null {
  const ctx = ctxDeUserContext(userContext as Parameters<typeof ctxDeUserContext>[0]);
  if (ctx && puedePublicarCarga(ctx)) {
    return null;
  }
  if (ctx && esSoloLectura(ctx)) {
    return c.json({ error: 'forbidden', code: 'read_only' }, 403);
  }
  return c.json(
    { error: 'forbidden', code: 'capability_denied', capability: 'puedePublicarCarga' },
    403,
  );
}

export {
  esGestor,
  esSoloLectura,
  puedeAdministrarEmpresa,
  puedeAsignarViaje,
  puedeGestionarFlota,
  puedeGestionarSucursales,
  puedeInvitarMiembro,
  puedeVerFinanzas,
  veSoloSuViaje,
};
