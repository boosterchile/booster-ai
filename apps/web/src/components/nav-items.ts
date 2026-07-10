import {
  Banknote,
  Building2,
  Bus,
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
  Users,
} from 'lucide-react';
import type { MeResponse } from '../hooks/use-me.js';

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
export function navSectionsForMe(me: MeOnboarded): NavSection[] {
  const empresa = me.active_membership?.empresa;
  const role = me.active_membership?.role;
  const isAdmin = role === 'dueno' || role === 'admin';

  // Stakeholder: membership sin empresa (XOR, ADR-034). Solo Inicio + Zonas.
  if (role === 'stakeholder_sostenibilidad') {
    return [{ items: [INICIO, { label: 'Zonas', to: '/app/stakeholder/zonas', icon: MapPinned }] }];
  }

  const sections: NavSection[] = [{ items: [INICIO] }];

  if (empresa?.is_transportista) {
    const transporte: NavItem[] = [
      { label: 'Seguimiento de flota', to: '/app/flota', icon: MapPinned },
      { label: 'Ofertas', to: '/app/ofertas', icon: Truck },
      { label: 'Vehículos', to: '/app/vehiculos', icon: Bus },
      { label: 'Conductores', to: '/app/conductores', icon: Users },
      { label: 'Cumplimiento', to: '/app/cumplimiento', icon: ShieldAlert },
      { label: 'Cobra hoy', to: '/app/cobra-hoy/historial', icon: Banknote },
      { label: 'Liquidaciones', to: '/app/liquidaciones', icon: Receipt },
    ];
    if (isAdmin) {
      transporte.push({ label: 'Dispositivos', to: '/app/admin/dispositivos', icon: Radio });
    }
    sections.push({ heading: 'Transporte', items: transporte });
  }

  if (empresa?.is_generador_carga) {
    sections.push({
      heading: 'Generador',
      items: [
        { label: 'Crear carga', to: '/app/cargas/nueva', icon: PackagePlus },
        { label: 'Mis cargas', to: '/app/cargas', icon: Package },
        { label: 'Sucursales', to: '/app/sucursales', icon: Building2 },
        { label: 'Certificados', to: '/app/certificados', icon: Leaf },
      ],
    });
  }

  return sections;
}
