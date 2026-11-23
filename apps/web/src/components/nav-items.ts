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
