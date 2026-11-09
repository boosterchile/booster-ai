import { z } from 'zod';
import { normalizeRut } from '../primitives/chile.js';
import { membershipRoleSchema } from './membership.js';

/**
 * Capacidades por rol, compartidas entre la web y el API.
 *
 * Cada función reemplaza un chequeo suelto de `role === …`. El catálogo
 * de esos chequeos está en `CHEQUEOS_REEMPLAZADOS`.
 *
 * `fichaConductorMismoRut` lo calcula quien tiene la base: la ficha viva
 * (`eliminado_en` nulo) de este usuario (`conductores.usuario_id`) en la
 * empresa activa, y el RUT de esa misma ficha coincide con el de la sesión.
 * No se busca el RUT en fichas de otros usuarios.
 *
 * Entregar y reportar un incidente no se deciden por rol: `puedeEjecutarViaje`
 * compara al usuario con `driver_user_id`. El API de esos dos endpoints lo
 * cierra el PR #816; este módulo no lo duplica.
 */
export const capacidadCtxSchema = z.object({
  role: membershipRoleSchema.nullable(),
  isTransportista: z.boolean(),
  isGeneradorCarga: z.boolean(),
  fichaConductorMismoRut: z.boolean(),
  puedeAceptarOfertas: z.boolean(),
});

export type CapacidadCtx = z.infer<typeof capacidadCtxSchema>;

/** RUT canónico, con o sin puntos. Vacío no coincide con nadie. */
export function mismoRut(
  rutUsuario: string | null | undefined,
  rutFicha: string | null | undefined,
): boolean {
  if (rutUsuario == null || rutFicha == null) {
    return false;
  }
  const a = normalizeRut(rutUsuario).trim();
  const b = normalizeRut(rutFicha).trim();
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  return a === b;
}

export function esSoloLectura(ctx: CapacidadCtx): boolean {
  return ctx.role === 'visualizador';
}

export function esGestor(ctx: CapacidadCtx): boolean {
  return ctx.role === 'dueno' || ctx.role === 'admin' || ctx.role === 'despachador';
}

export function esDuenoOAdmin(ctx: CapacidadCtx): boolean {
  return ctx.role === 'dueno' || ctx.role === 'admin';
}

/** Dueño de la empresa activa con ficha viva de conductor del mismo RUT. */
export function esOwnerOperator(ctx: CapacidadCtx): boolean {
  return ctx.role === 'dueno' && ctx.fichaConductorMismoRut;
}

/** Reemplaza `role === 'conductor'` en `/app/conductor` y su configuración. */
export function puedeVerPanelConductor(ctx: CapacidadCtx): boolean {
  return ctx.role === 'conductor' || esOwnerOperator(ctx);
}

/** Dueño y admin: empresa, zonas, trayectos, dispositivos, borrar. */
export function puedeAdministrarEmpresa(ctx: CapacidadCtx): boolean {
  return esDuenoOAdmin(ctx);
}

/** Reemplaza el botón «Invitar miembro» y `ROLES_QUE_GESTIONAN` del alta. */
export function puedeInvitarMiembro(ctx: CapacidadCtx): boolean {
  return puedeAdministrarEmpresa(ctx);
}

/**
 * Liquidaciones, historial de Cobra hoy y pedir Cobra hoy.
 * El despachador, el conductor y el visualizador quedan fuera.
 */
export function puedeVerFinanzas(ctx: CapacidadCtx): boolean {
  return ctx.isTransportista && esDuenoOAdmin(ctx);
}

export function puedePedirCobraHoy(ctx: CapacidadCtx): boolean {
  return puedeVerFinanzas(ctx);
}

/** El despachador asigna sin el permiso de aceptar ofertas. */
export function puedeAsignarViaje(ctx: CapacidadCtx): boolean {
  return ctx.isTransportista && esGestor(ctx);
}

/**
 * Dueño y admin siempre. El despachador solo si la membresía tiene
 * `puede_aceptar_ofertas`. Conductor y visualizador nunca, aunque el
 * flag esté en true.
 */
export function puedeAceptarOferta(ctx: CapacidadCtx): boolean {
  if (!ctx.isTransportista || esSoloLectura(ctx)) {
    return false;
  }
  if (ctx.role === 'dueno' || ctx.role === 'admin') {
    return true;
  }
  if (ctx.role === 'despachador') {
    return ctx.puedeAceptarOfertas;
  }
  return false;
}

/** Tarjeta «Aceptar por voz» en Ofertas. Reemplaza `tiene_ficha_conductor`. */
export function puedeAceptarPorVoz(ctx: CapacidadCtx): boolean {
  return ctx.isTransportista && esOwnerOperator(ctx);
}

/**
 * Retiro, entrega, incidente, GPS y voz del viaje.
 * Misma comparación que `esConductorDelViaje` y que #816 en el API.
 */
export function puedeEjecutarViaje(
  viewerUserId: string | null | undefined,
  driverUserId: string | null | undefined,
): boolean {
  if (viewerUserId == null || driverUserId == null) {
    return false;
  }
  if (viewerUserId.length === 0 || driverUserId.length === 0) {
    return false;
  }
  return viewerUserId === driverUserId;
}

/** Alta y edición de vehículos, conductores y documentos de transporte. */
export function puedeGestionarFlota(ctx: CapacidadCtx): boolean {
  return ctx.isTransportista && esGestor(ctx);
}

export function puedeGestionarDocumentosTransporte(ctx: CapacidadCtx): boolean {
  return puedeGestionarFlota(ctx);
}

/** Borrar vehículo o conductor, y asociar dispositivo: dueño y admin. */
export function puedeBorrarEnFlota(ctx: CapacidadCtx): boolean {
  return ctx.isTransportista && esDuenoOAdmin(ctx);
}

/**
 * El conductor empleado no ve la flota. El dueño que conduce sí: su rol
 * es `dueno`. El visualizador la ve, sin poder escribir.
 */
export function puedeVerMapaFlota(ctx: CapacidadCtx): boolean {
  return ctx.isTransportista && ctx.role !== 'conductor' && ctx.role !== null;
}

/** El conductor empleado solo ve los viajes donde él es `driver_user_id`. */
export function veSoloSuViaje(ctx: CapacidadCtx): boolean {
  return ctx.role === 'conductor';
}

/** Crear y cancelar cargas. El visualizador del generador no. */
export function puedePublicarCarga(ctx: CapacidadCtx): boolean {
  return ctx.isGeneradorCarga && esGestor(ctx);
}

export function puedeCancelarCarga(ctx: CapacidadCtx): boolean {
  return puedePublicarCarga(ctx);
}

/** Sucursales: gestor de una empresa generadora. */
export function puedeGestionarSucursales(ctx: CapacidadCtx): boolean {
  return ctx.isGeneradorCarga && esGestor(ctx);
}

/**
 * El visualizador es solo lectura en toda la app y en todo endpoint de
 * escritura. No incluye el link público de tracking, que no tiene rol.
 */
export function puedeEscribir(ctx: CapacidadCtx): boolean {
  return ctx.role !== null && !esSoloLectura(ctx);
}

/** El conductor empleado no entra al menú de gestión. El dueño que conduce sí. */
export function puedeVerMenuGestion(ctx: CapacidadCtx): boolean {
  return ctx.role !== 'conductor' && ctx.role !== null;
}

export const CAPACIDADES = {
  puedeAceptarOferta,
  puedeAsignarViaje,
  puedeAceptarPorVoz,
  puedeVerPanelConductor,
  puedeVerFinanzas,
  puedePedirCobraHoy,
  puedeVerMapaFlota,
  puedePublicarCarga,
  puedeCancelarCarga,
  puedeInvitarMiembro,
  puedeAdministrarEmpresa,
  puedeGestionarFlota,
  puedeGestionarDocumentosTransporte,
  puedeGestionarSucursales,
  puedeEscribir,
  puedeVerMenuGestion,
} as const;

export type NombreCapacidad = keyof typeof CAPACIDADES;

export function tieneCapacidad(nombre: NombreCapacidad, ctx: CapacidadCtx): boolean {
  return CAPACIDADES[nombre](ctx);
}

/**
 * Chequeos sueltos que estas funciones reemplazan. La cita queda en el
 * módulo para que el diff de cada pantalla apunte acá y no reintroduzca
 * un `role === …`.
 */
export const CHEQUEOS_REEMPLAZADOS = [
  {
    id: 'ofertas-voz',
    archivo: 'apps/web/src/routes/ofertas.tsx',
    antes: "role === 'dueno' && tiene_ficha_conductor",
    ahora: 'puedeAceptarPorVoz',
  },
  {
    id: 'ofertas-botones',
    archivo: 'apps/web/src/components/offers/OfferCard.tsx',
    antes: 'Aceptar y Rechazar sin rol',
    ahora: 'puedeAceptarOferta',
  },
  {
    id: 'offers-api',
    archivo: 'apps/api/src/routes/offers.ts',
    antes: 'POST accept|reject solo isTransportista',
    ahora: 'puedeAceptarOferta',
  },
  {
    id: 'entrega-incidente-ui',
    archivo: 'apps/web/src/lib/es-conductor-del-viaje.ts',
    antes: 'viewerUserId === driverUserId',
    ahora: 'puedeEjecutarViaje',
  },
  {
    id: 'asignar-ui',
    archivo: 'apps/web/src/routes/asignacion-detalle.tsx',
    antes: 'DriverAssignmentCard sin rol',
    ahora: 'puedeAsignarViaje',
  },
  {
    id: 'asignar-api',
    archivo: 'apps/api/src/routes/assignments.ts',
    antes: 'allowedRoles dueno|admin|despachador y role === en confirmar-recogida',
    ahora: 'puedeAsignarViaje / esGestor',
  },
  {
    id: 'cobra-hoy-ui',
    archivo: 'apps/web/src/routes/asignacion-detalle.tsx',
    antes: 'isDelivered sin rol',
    ahora: 'puedePedirCobraHoy',
  },
  {
    id: 'cobra-hoy-api',
    archivo: 'apps/api/src/routes/cobra-hoy.ts',
    antes: 'POST y GET historial/cotización sin rol',
    ahora: 'puedeVerFinanzas',
  },
  {
    id: 'liquidaciones',
    archivo: 'apps/api/src/routes/me-liquidaciones.ts',
    antes: 'solo isTransportista',
    ahora: 'puedeVerFinanzas',
  },
  {
    id: 'documentos',
    archivo: 'apps/web/src/lib/transport-documents-api.ts',
    antes: 'canWriteTransportDocuments dueno|admin|despachador',
    ahora: 'puedeGestionarDocumentosTransporte',
  },
  {
    id: 'panel-conductor',
    archivo: 'apps/web/src/routes/conductor.tsx',
    antes: "role !== 'conductor'",
    ahora: 'puedeVerPanelConductor',
  },
  {
    id: 'panel-conductor-config',
    archivo: 'apps/web/src/routes/conductor-configuracion.tsx',
    antes: "role !== 'conductor'",
    ahora: 'puedeVerPanelConductor',
  },
  {
    id: 'nav-gestion',
    archivo: 'apps/web/src/components/nav-items.ts',
    antes: 'sección Transporte para cualquier rol de la empresa',
    ahora: 'puedeVerMenuGestion + puedeVerFinanzas + puedePublicarCarga',
  },
  {
    id: 'servicios-asignar',
    archivo: 'apps/web/src/routes/servicios.tsx',
    antes: 'enlace Asignar sin rol',
    ahora: 'puedeAsignarViaje',
  },
  {
    id: 'assignments-lista',
    archivo: 'apps/api/src/routes/assignments.ts',
    antes: 'GET / sin rol',
    ahora: 'veSoloSuViaje filtra driver_user_id',
  },
  {
    id: 'flota',
    archivo: 'apps/api/src/routes/vehiculos.ts',
    antes: 'GET /flota y /:id/ubicacion sin rol',
    ahora: 'veSoloSuViaje',
  },
  {
    id: 'vehiculos-ui',
    archivo: 'apps/web/src/routes/vehiculos.tsx',
    antes: 'canWrite dueno|admin|despachador; canDelete dueno|admin',
    ahora: 'puedeGestionarFlota / puedeBorrarEnFlota',
  },
  {
    id: 'conductores-ui',
    archivo: 'apps/web/src/routes/conductores.tsx',
    antes: 'canWrite dueno|admin|despachador',
    ahora: 'puedeGestionarFlota',
  },
  {
    id: 'invitar',
    archivo: 'apps/web/src/routes/equipo.tsx',
    antes: 'botón Agregar persona sin rol',
    ahora: 'puedeInvitarMiembro',
  },
  {
    id: 'empresa',
    archivo: 'apps/web/src/routes/empresa.tsx',
    antes: "role === 'dueno' || role === 'admin'",
    ahora: 'puedeAdministrarEmpresa',
  },
  {
    id: 'zonas',
    archivo: 'apps/web/src/routes/zonas.tsx',
    antes: 'is_transportista && (dueno|admin)',
    ahora: 'puedeAdministrarEmpresa',
  },
  {
    id: 'trayectos',
    archivo: 'apps/web/src/routes/trayectos-teltonika.tsx',
    antes: 'is_transportista && (dueno|admin)',
    ahora: 'puedeAdministrarEmpresa',
  },
  {
    id: 'dispositivos',
    archivo: 'apps/web/src/routes/admin-dispositivos.tsx',
    antes: "role !== 'dueno' && role !== 'admin'",
    ahora: 'puedeAdministrarEmpresa',
  },
  {
    id: 'cargas',
    archivo: 'apps/web/src/routes/cargas.tsx',
    antes: 'Nueva carga y Cancelar sin rol',
    ahora: 'puedePublicarCarga',
  },
  {
    id: 'trip-requests',
    archivo: 'apps/api/src/routes/trip-requests-v2.ts',
    antes: 'requireShipper sin rol en POST y cancelar',
    ahora: 'puedePublicarCarga',
  },
  {
    id: 'sucursales',
    archivo: 'apps/web/src/routes/sucursales.tsx',
    antes: 'canWrite dueno|admin|despachador',
    ahora: 'puedeGestionarSucursales',
  },
  {
    id: 'inicio-plata',
    archivo: 'apps/web/src/components/inicio-transportista/modelo.ts',
    antes: 'Cobra hoy y Liquidaciones para todo transportista',
    ahora: 'puedeVerFinanzas',
  },
] as const;
