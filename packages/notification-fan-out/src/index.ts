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
