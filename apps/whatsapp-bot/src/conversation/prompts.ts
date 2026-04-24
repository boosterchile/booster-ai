/**
 * Strings en español chileno para los prompts del bot.
 *
 * Mantener aquí todas las strings user-facing facilita i18n futuro y revisiones
 * de tono por alguien no-dev.
 */

export const PROMPTS = {
  greeting:
    '¡Hola! Soy Booster AI — marketplace B2B de transporte de carga en Chile.\n\n' +
    'Responde con:\n' +
    '1️⃣ Para *crear una nueva solicitud de carga*\n' +
    '2️⃣ Para *consultar una solicitud existente*\n\n' +
    'O escribe "cancelar" para salir en cualquier momento.',

  askOrigin:
    '📍 ¿Desde qué dirección u origen sale la carga?\n\n' +
    'Ejemplo: "Parque Industrial Quilicura, Santiago" o "Av. Los Leones 1234, Providencia"',

  askDestination:
    '🎯 ¿A qué dirección debe llegar la carga?\n\n' +
    'Ejemplo: "Puerto de Valparaíso" o "Calle Prat 2500, Antofagasta"',

  askCargoType:
    '📦 ¿Qué tipo de carga es?\n\n' +
    '1️⃣ Carga seca / General\n' +
    '2️⃣ Perecible\n' +
    '3️⃣ Refrigerada\n' +
    '4️⃣ Congelada\n' +
    '5️⃣ Frágil\n' +
    '6️⃣ Peligrosa (IMO / MERCOSUR)\n' +
    '7️⃣ Líquido a granel\n' +
    '8️⃣ Construcción\n' +
    '9️⃣ Agrícola\n' +
    '🔟 Ganado vivo\n' +
    '0️⃣ Otro',

  askPickupDate:
    '📅 ¿Cuándo necesitas que retiren la carga?\n\n' +
    'Puedes responder como prefieras — "mañana por la mañana", "el 15 de mayo", "lo antes posible", etc.',

  confirmed: (trackingCode: string) =>
    `✅ ¡Listo! Registramos tu solicitud.\n\nTu código de seguimiento es: *${trackingCode}*\n\nGuárdalo — podrás consultarlo en cualquier momento.\n\nAhora estamos buscando al carrier más adecuado. Te avisaremos por este mismo chat apenas tengamos una propuesta. Normalmente toma entre 10 y 30 minutos en horario hábil.`,

  cancelled: '❌ Conversación cancelada. Escríbeme cuando quieras empezar de nuevo.',

  menuLookupNotImplemented:
    '🚧 La consulta de solicitudes existentes aún no está disponible — volveremos con eso pronto.\n\n' +
    'Por ahora puedes enviar "1" para crear una nueva solicitud.',

  invalidMenuOption:
    '🤔 No entendí. Responde *1* para crear una solicitud, *2* para consultar una existente, o "cancelar".',

  invalidCargoOption: '🤔 No entendí. Responde con el número del tipo de carga (del 0 al 10).',

  unknownCommand: '🤖 Para empezar, escribe "hola".',
} as const;

/**
 * Mapping de input numérico del menú de cargo types a los enum values del schema.
 */
export const CARGO_TYPE_MENU_MAP: Record<string, string> = {
  '1': 'dry_goods',
  '2': 'perishable',
  '3': 'refrigerated',
  '4': 'frozen',
  '5': 'fragile',
  '6': 'dangerous',
  '7': 'liquid',
  '8': 'construction',
  '9': 'agricultural',
  '10': 'livestock',
  '0': 'other',
};
