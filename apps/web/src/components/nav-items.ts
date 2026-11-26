import {
  Banknote,
  Building2,
  Bus,
  ClipboardList,
  Fuel,
  Gauge,
  Home,
  Leaf,
  type LucideIcon,
  MapPinned,
  Package,
  PackagePlus,
  Radio,
  Receipt,
  ShieldAlert,
  Truck,
  UserCog,
  Users,
  Waypoints,
} from 'lucide-react';
import type { MeResponse } from '../hooks/use-me.js';
import { type FlagsCapacidad, flagsDe } from '../lib/capacidades.js';
import { productoDe } from '../lib/producto.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export interface NavSection {
  /** Encabezado de sección (opcional). */
  heading?: string;
  items: NavItem[];
}

const INICIO: NavItem = { label: 'Inicio', to: '/app', icon: Home };

/**
 * Navegación role-aware para el sidebar del shell de operador. Deriva de
 * `me.active_membership` (rol + flags de empresa) — mismo criterio que hoy vive
 * en las secciones condicionales de `app.tsx`. Una empresa puede ser
 * transportista Y generador: se muestran ambas secciones.
 *
 * El conductor y el platform-admin NO usan este shell (tienen shell propio), así
 * que no se modelan acá.
 */
export function navSectionsForMe(
  me: MeOnboarded,
  opciones: { rutas?: boolean } = {},
): NavSection[] {
  const empresa = me.active_membership?.empresa;
  const role = me.active_membership?.role;
  const flags = flagsDe(me);
  const isAdmin = flags.administrar;

  // Stakeholder: membership sin empresa (XOR, ADR-034). Solo Inicio + Zonas.
  if (role === 'stakeholder_sostenibilidad') {
    return [{ items: [INICIO, { label: 'Zonas', to: '/app/stakeholder/zonas', icon: MapPinned }] }];
  }

  // CHEQUEOS_REEMPLAZADOS nav-gestion: el conductor empleado solo ve su viaje.
  if (flags.ctx && !flags.menuGestion) {
    return [{ items: [{ label: 'Mi viaje', to: '/app/conductor', icon: Truck }] }];
  }

  if (productoDe(me) === 'fleet') {
    return navFleet({ flags, esDueno: role === 'dueno', rutas: opciones.rutas === true });
  }

  const inicioItems: NavItem[] = [INICIO];
  if (flags.panelConductor && role === 'dueno') {
    inicioItems.push({ label: 'Mi viaje', to: '/app/conductor', icon: Truck });
  }
  if (empresa && isAdmin) {
    inicioItems.push({ label: 'Empresa', to: '/app/empresa', icon: Leaf });
  }
  // equipo-de-la-empresa / equipo-generador: la gente es de la empresa, no
  // del rol de la empresa. La ve todo operador; el backend decide quién da
  // de alta (dueño y admin).
  if (empresa) {
    inicioItems.push({ label: 'Equipo', to: '/app/equipo', icon: UserCog });
  }
  const sections: NavSection[] = [{ items: inicioItems }];

  if (empresa?.is_transportista) {
    const transporte: NavItem[] = [
      { label: 'Seguimiento de flota', to: '/app/flota', icon: MapPinned },
    ];
    if (isAdmin) {
      transporte.unshift({ label: 'Booster Fleet', to: '/app/booster-fleet', icon: Gauge });
    }
    // servicios-por-empresa: sin el servicio de ofertas de carga la empresa
    // opera con Booster Fleet y sus viajes propios; no ve Ofertas, la plata
    // (ya la corta `verFinanzas`) ni Zonas de matching.
    if (flags.ofertasCarga) {
      transporte.push({ label: 'Ofertas', to: '/app/ofertas', icon: Truck });
    }
    transporte.push(
      // Servicios va inmediatamente después de Ofertas porque ese es el flujo
      // real: llega la oferta, se acepta, y la carga hay que despacharla —
      // asignarle conductor. Sin esta entrada, la asignación quedaba
      // inalcanzable salvo desde Cobra Hoy o Liquidaciones (pantallas de
      // plata), y en prod eso dejó 0 asignaciones con conductor.
      { label: 'Servicios', to: '/app/servicios', icon: ClipboardList },
      { label: 'Vehículos', to: '/app/vehiculos', icon: Bus },
      { label: 'Conductores', to: '/app/conductores', icon: Users },
      { label: 'Cumplimiento', to: '/app/cumplimiento', icon: ShieldAlert },
    );
    // Rutas va después de Servicios: primero se acepta la carga y se le pone
    // conductor; después se junta con otras. Solo con la API encendida.
    if (opciones.rutas) {
      const despuesDeServicios = transporte.findIndex((item) => item.label === 'Servicios');
      transporte.splice(despuesDeServicios + 1, 0, {
        label: 'Rutas',
        to: '/app/rutas',
        icon: Waypoints,
      });
    }
    // CHEQUEOS_REEMPLAZADOS nav-gestion / inicio-plata: la plata es dueño y admin.
    if (flags.verFinanzas) {
      transporte.push(
        { label: 'Cobra hoy', to: '/app/cobra-hoy/historial', icon: Banknote },
        { label: 'Liquidaciones', to: '/app/liquidaciones', icon: Receipt },
      );
    }
    if (isAdmin) {
      const despuesDelMapa = transporte.findIndex((item) => item.label === 'Seguimiento de flota');
      transporte.splice(despuesDelMapa + 1, 0, {
        label: 'Trayectos',
        to: '/app/trayectos',
        icon: Fuel,
      });
      if (flags.ofertasCarga) {
        transporte.push({ label: 'Zonas de matching', to: '/app/zonas', icon: MapPinned });
      }
      transporte.push({ label: 'Dispositivos', to: '/app/admin/dispositivos', icon: Radio });
    }
    sections.push({ heading: 'Transporte', items: transporte });
  }

  if (empresa?.is_generador_carga) {
    const generador: NavItem[] = [];
    // CHEQUEOS_REEMPLAZADOS cargas: el visualizador no crea cargas.
    if (flags.publicarCarga) {
      generador.push({ label: 'Crear carga', to: '/app/cargas/nueva', icon: PackagePlus });
    }
    generador.push(
      { label: 'Mis cargas', to: '/app/cargas', icon: Package },
      { label: 'Sucursales', to: '/app/sucursales', icon: Building2 },
      { label: 'Certificados', to: '/app/certificados', icon: Leaf },
    );
    sections.push({
      heading: 'Generador',
      items: generador,
    });
  }

  return sections;
}

/**
 * Menú del producto Booster Fleet (`.specs/booster-fleet-interfaz` §4.2): la
 * empresa solo de flota no ve nada del marketplace. El dueño y el admin
 * parten en el panel de flota; los demás roles, en el Inicio.
 */
function navFleet(opts: { flags: FlagsCapacidad; esDueno: boolean; rutas: boolean }): NavSection[] {
  const { flags } = opts;
  const esAdmin = flags.administrar;

  const principal: NavItem[] = [
    esAdmin ? { label: 'Panel de flota', to: '/app/booster-fleet', icon: Gauge } : INICIO,
  ];
  if (flags.panelConductor && opts.esDueno) {
    principal.push({ label: 'Mi viaje', to: '/app/conductor', icon: Truck });
  }
  if (esAdmin) {
    principal.push({ label: 'Empresa', to: '/app/empresa', icon: Leaf });
  }
  principal.push({ label: 'Equipo', to: '/app/equipo', icon: UserCog });

  const flota: NavItem[] = [{ label: 'Seguimiento de flota', to: '/app/flota', icon: MapPinned }];
  if (esAdmin) {
    flota.push({ label: 'Trayectos', to: '/app/trayectos', icon: Fuel });
  }
  flota.push(
    { label: 'Vehículos', to: '/app/vehiculos', icon: Bus },
    { label: 'Conductores', to: '/app/conductores', icon: Users },
    { label: 'Cumplimiento', to: '/app/cumplimiento', icon: ShieldAlert },
  );
  if (esAdmin) {
    flota.push({ label: 'Dispositivos', to: '/app/admin/dispositivos', icon: Radio });
  }

  const viajes: NavItem[] = [{ label: 'Servicios', to: '/app/servicios', icon: ClipboardList }];
  if (opts.rutas) {
    viajes.push({ label: 'Rutas', to: '/app/rutas', icon: Waypoints });
  }

  return [
    { items: principal },
    { heading: 'Flota', items: flota },
    { heading: 'Viajes propios', items: viajes },
  ];
}

/** Grupo del menú superior (frente 8, `.specs/frente8-menu-superior`). */
export interface NavGroup {
  id: NavGroupId;
  label: string;
  /** Nombre para la barra inferior bajo 640 px. */
  shortLabel: string;
  icon: LucideIcon;
  /** Pantallas del grupo, en orden. La primera es el destino de la entrada. */
  items: NavItem[];
}

export type NavGroupId =
  | 'inicio'
  | 'mi-viaje'
  | 'flota'
  | 'viajes'
  | 'ofertas'
  | 'cargas'
  | 'huella'
  | 'empresa'
  | 'zonas';

const ORDEN_GRUPOS: NavGroupId[] = [
  'inicio',
  'mi-viaje',
  'flota',
  'viajes',
  'ofertas',
  'cargas',
  'huella',
  'empresa',
  'zonas',
];

const GRUPO_POR_RUTA: Record<string, NavGroupId> = {
  '/app': 'inicio',
  '/app/conductor': 'inicio',
  '/app/booster-fleet': 'flota',
  '/app/flota': 'flota',
  '/app/trayectos': 'flota',
  '/app/vehiculos': 'flota',
  '/app/conductores': 'flota',
  '/app/cumplimiento': 'flota',
  '/app/admin/dispositivos': 'flota',
  '/app/servicios': 'viajes',
  '/app/rutas': 'viajes',
  '/app/cobra-hoy/historial': 'viajes',
  '/app/liquidaciones': 'viajes',
  '/app/ofertas': 'ofertas',
  '/app/cargas': 'cargas',
  '/app/cargas/nueva': 'cargas',
  '/app/sucursales': 'cargas',
  '/app/certificados': 'huella',
  '/app/empresa': 'empresa',
  '/app/equipo': 'empresa',
  '/app/zonas': 'empresa',
  '/app/stakeholder/zonas': 'zonas',
};

/**
 * Menú superior del armazón de operador (decisión 1 del PO del 2026-11-25).
 * Reagrupa las mismas pantallas de `navSectionsForMe`, así que los permisos
 * no cambian: el menú reordena, no abre ni cierra accesos.
 */
export function navGroupsForMe(me: MeOnboarded, opciones: { rutas?: boolean } = {}): NavGroup[] {
  const items = navSectionsForMe(me, opciones).flatMap((s) => s.items);
  const fleet = productoDe(me) === 'fleet';
  const soloMiViaje = items.length === 1 && items[0]?.to === '/app/conductor';
  const tieneInicio = items.some((i) => i.to === '/app');

  const porGrupo = new Map<NavGroupId, NavItem[]>();
  for (const item of items) {
    let grupo = GRUPO_POR_RUTA[item.to] ?? 'inicio';
    if (soloMiViaje) {
      grupo = 'mi-viaje';
    } else if (fleet && !tieneInicio && item.to === '/app/booster-fleet') {
      // Booster Fleet: el panel de flota es el Inicio del dueño y del admin.
      grupo = 'inicio';
    }
    const lista = porGrupo.get(grupo) ?? [];
    lista.push(item);
    porGrupo.set(grupo, lista);
  }

  return ORDEN_GRUPOS.flatMap((id) => {
    const lista = porGrupo.get(id);
    if (!lista || lista.length === 0) {
      return [];
    }
    return [{ id, ...encabezadoGrupo(id, fleet), items: lista }];
  });
}

function encabezadoGrupo(
  id: NavGroupId,
  fleet: boolean,
): { label: string; shortLabel: string; icon: LucideIcon } {
  switch (id) {
    case 'inicio':
      return { label: 'Inicio', shortLabel: 'Inicio', icon: Home };
    case 'mi-viaje':
      return { label: 'Mi viaje', shortLabel: 'Mi viaje', icon: Truck };
    case 'flota':
      return { label: 'Flota', shortLabel: 'Flota', icon: Bus };
    case 'viajes':
      return fleet
        ? { label: 'Viajes propios', shortLabel: 'Viajes', icon: ClipboardList }
        : { label: 'Viajes', shortLabel: 'Viajes', icon: ClipboardList };
    case 'ofertas':
      return { label: 'Ofertas', shortLabel: 'Ofertas', icon: Truck };
    case 'cargas':
      return { label: 'Mis cargas', shortLabel: 'Cargas', icon: Package };
    case 'huella':
      return { label: 'Huella y certificados', shortLabel: 'Huella', icon: Leaf };
    case 'empresa':
      return { label: 'Empresa', shortLabel: 'Empresa', icon: Building2 };
    case 'zonas':
      return { label: 'Zonas', shortLabel: 'Zonas', icon: MapPinned };
  }
}

/** Prefijo de ruta que cuenta como «dentro» de una pantalla del menú. */
function prefijoDe(to: string): string {
  return to === '/app/cobra-hoy/historial' ? '/app/cobra-hoy' : to;
}

function coincide(pathname: string, to: string): boolean {
  if (to === '/app') {
    return pathname === '/app' || pathname === '/app/';
  }
  const prefijo = prefijoDe(to);
  return pathname === prefijo || pathname.startsWith(`${prefijo}/`);
}

/** La pantalla del menú que corresponde a la ruta: la de prefijo más largo. */
export function itemActivo(groups: NavGroup[], pathname: string): NavItem | null {
  let mejor: NavItem | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    if (coincide(pathname, item.to) && (!mejor || item.to.length > mejor.to.length)) {
      mejor = item;
    }
  }
  return mejor;
}

/** El grupo que contiene la pantalla activa, si la hay. */
export function grupoActivo(groups: NavGroup[], pathname: string): NavGroup | null {
  const item = itemActivo(groups, pathname);
  return item ? (groups.find((g) => g.items.includes(item)) ?? null) : null;
}
