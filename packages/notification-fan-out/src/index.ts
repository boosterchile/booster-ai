/**
 * @booster-ai/notification-fan-out
 *
 * Helpers y contratos para el dispatcher de notificaciones a
 * transportistas tras crear ofertas.
 *
 * En B0 sólo soporta WhatsApp via Twilio Content Templates aprobados; en
 * slices posteriores agregaremos FCM (driver app), email, SMS y Web Push
 * con prioridades por canal según preferencia del usuario.
 *
 * Acoplamiento: este package contiene los formatters puros y los tipos de
 * contrato. La orquestación DB (queries) vive en `apps/api/src/services/
 * notify-offer.ts` que importa de acá. Esto evita el círculo
 * package → app sin sacrificar tipado fuerte de Drizzle.
 */

const REGION_LABELS: Record<string, string> = {
  XV: 'Arica',
  I: 'Tarapacá',
  II: 'Antofagasta',
  III: 'Atacama',
  IV: 'Coquimbo',
  V: 'Valparaíso',
  XIII: 'Metropolitana',
  VI: "O'Higgins",
  VII: 'Maule',
  XVI: 'Ñuble',
  VIII: 'Biobío',
  IX: 'Araucanía',
  XIV: 'Los Ríos',
  X: 'Los Lagos',
  XI: 'Aysén',
  XII: 'Magallanes',
};

export function formatPriceClp(value: number): string {
  return `$ ${value.toLocaleString('es-CL')} CLP`;
}

export function regionLabel(code: string | null): string {
  if (code === null) {
    return '—';
  }
  return REGION_LABELS[code] ?? code;
}

/**
 * Construye las variables del template Twilio `offer_new_v1`.
 *
 * El template tiene 4 variables 1-indexadas:
 *   {{1}} tracking_code
 *   {{2}} ruta legible (origen → destino)
 *   {{3}} precio CLP formateado
 *   {{4}} URL del dashboard de ofertas
 */
export function buildOfferTemplateVariables(input: {
  trackingCode: string;
  originRegionCode: string | null;
  destinationRegionCode: string | null;
  proposedPriceClp: number;
  webAppUrl: string;
}): Record<string, string> {
  const route = `${regionLabel(input.originRegionCode)} → ${regionLabel(input.destinationRegionCode)}`;
  return {
    '1': input.trackingCode,
    '2': route,
    '3': formatPriceClp(input.proposedPriceClp),
    '4': `${input.webAppUrl.replace(/\/$/, '')}/app/ofertas`,
  };
}

/**
 * Resultado de un intento de envío a un transportista. El dispatcher
 * decide skip si la oferta ya fue notificada, no hay config, etc.
 */
export interface NotifyOfferResult {
  offerId: string;
  skipped: boolean;
  reason?: 'already_notified' | 'not_configured' | 'no_whatsapp' | 'no_owner' | 'offer_not_found';
  twilioMessageSid?: string;
}

// ----------------------------------------------------------------------------
// Coaching post-entrega — Phase 3 PR-J3
// ----------------------------------------------------------------------------
// Template Twilio `coaching_post_entrega_v1` con 4 variables:
//   {{1}} tracking_code (e.g. "BST-00421")
//   {{2}} score + nivel  (e.g. "85/100 · Bueno")
//   {{3}} mensaje de coaching (≤320 chars, generado por
//         @booster-ai/coaching-generator)
//   {{4}} URL al detalle del trip en la PWA

const NIVEL_LABEL: Record<string, string> = {
  excelente: 'Excelente',
  bueno: 'Bueno',
  regular: 'Regular',
  malo: 'Mejorar',
};

/** Trunca a `max` chars sin partir palabras a mitad. Usa "…" si trunca. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  // Buscar último espacio antes del corte para no partir palabras.
  const slice = text.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > Math.floor(max * 0.6) ? lastSpace : max - 1;
  return `${slice.slice(0, cut)}…`;
}

/**
 * Construye las variables del template Twilio `coaching_post_entrega_v1`.
 *
 * - El score se redondea a entero (Twilio variables son strings — el render
 *   en Meta no soporta number formatting).
 * - El nivel se mapea a label legible en español ("Bueno", "Mejorar"); si
 *   viene un nivel desconocido (ej. enum nuevo no espejado acá), se usa
 *   el slug crudo en title-case como fallback.
 * - El mensaje se trunca defensivamente a 280 chars: aunque el package
 *   coaching-generator garantiza ≤320, Twilio rechaza variables > 1024
 *   pero algunos clientes WhatsApp viejos cortan a ~300. Trunc a 280 deja
 *   margen para el resto del template.
 * - La URL apunta al detalle del trip (`/app/viajes/{tripId}`), no al
 *   listado, para landing directo al coaching card.
 */
export function buildCoachingTemplateVariables(input: {
  trackingCode: string;
  score: number;
  nivel: string;
  mensaje: string;
  tripId: string;
  webAppUrl: string;
}): Record<string, string> {
  const nivelLabel = NIVEL_LABEL[input.nivel] ?? toTitleCase(input.nivel);
  return {
    '1': input.trackingCode,
    '2': `${Math.round(input.score)}/100 · ${nivelLabel}`,
    '3': truncate(input.mensaje.trim(), 280),
    '4': `${input.webAppUrl.replace(/\/$/, '')}/app/viajes/${input.tripId}`,
  };
}

function toTitleCase(s: string): string {
  if (s.length === 0) {
    return s;
  }
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Resultado de un intento de envío de coaching post-entrega. Mismo shape
 * que NotifyOfferResult con distintos códigos de skip aplicables al flujo
 * coaching.
 */
export interface NotifyCoachingResult {
  tripId: string;
  skipped: boolean;
  reason?:
    | 'already_notified'
    | 'not_configured'
    | 'no_whatsapp'
    | 'no_owner'
    | 'no_assignment'
    | 'no_coaching_persisted'
    | 'trip_not_found';
  twilioMessageSid?: string;
}
