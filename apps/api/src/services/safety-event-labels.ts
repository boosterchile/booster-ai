import type { SafetyEvent } from '@booster-ai/shared-schemas';

/**
 * Labels en español de cada tipo de evento de seguridad, para mostrar al
 * transportista en la notificación (push + WhatsApp). Mapping de presentación
 * (los valores del enum son códigos técnicos en inglés).
 */
const LABELS: Record<SafetyEvent['eventType'], string> = {
  crash: 'Posible colisión',
  unplug: 'Desconexión de energía (manipulación)',
  jamming: 'Interferencia de señal GPS',
};

export function safetyEventLabel(eventType: SafetyEvent['eventType']): string {
  return LABELS[eventType];
}
