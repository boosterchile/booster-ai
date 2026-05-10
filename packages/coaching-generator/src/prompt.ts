import type { ParametrosCoaching } from './tipos.js';

/**
 * Construye el prompt para Gemini. Pure function, no I/O.
 *
 * **Por qué prompt curado, no improvisado**:
 *
 *   - Eval suite: cada cambio de prompt se valida con N casos
 *     conocidos (ver test/prompt.test.ts) para que un cambio que
 *     "mejora" un caso no rompa los otros 9.
 *   - Determinismo: temperature=0 + system prompt explícito reduce
 *     varianza output → posible cachear por hash del input.
 *   - Tono: el coaching va al transportista, no al despachador. El
 *     prompt explicita "respetuoso, accionable, sin culpabilizar".
 *
 * Estructura: system prompt invariante + user prompt con datos
 * concretos del trip. Gemini recibe los dos como mensajes separados
 * (el caller los pasa al SDK; el genFn injectable los recibe como
 * objeto).
 */

export const SYSTEM_PROMPT = `Eres un coach de conducción para transportistas chilenos.
Tu objetivo es darle feedback breve y accionable a un conductor sobre cómo manejar más
suave para reducir consumo de combustible, desgaste del vehículo y huella de carbono.

Reglas estrictas:
1. Responde SIEMPRE en español de Chile, neutral (sin "guey", "tío", etc.).
2. Máximo 280 caracteres (cabe en SMS / WhatsApp template).
3. Tono respetuoso. NUNCA culpabilizar o usar "deberías" agresivo.
4. Mensaje accionable: si hay problema, sugerir UNA acción concreta.
5. Si el viaje fue excelente, felicitar específicamente — no genérico.
6. Datos: usa SOLO los counts y números del input. NO inventes detalles
   (no asumas qué hora era, qué tráfico había, etc.).
7. NO uses emojis. NO uses bullets. Texto plano.`;

export function buildUserPrompt(params: ParametrosCoaching): string {
  const { score, nivel, desglose, trip } = params;
  return `Datos del viaje recién terminado:

- Distancia: ${trip.distanciaKm.toFixed(0)} km
- Duración: ${trip.duracionMinutos.toFixed(0)} min
- Tipo de carga: ${trip.tipoCarga}
- Score de conducción: ${score}/100 (${nivel})

Eventos detectados:
- Aceleraciones bruscas: ${desglose.aceleracionesBruscas}
- Frenados bruscos: ${desglose.frenadosBruscos}
- Curvas tomadas con fuerza: ${desglose.curvasBruscas}
- Excesos de velocidad: ${desglose.excesosVelocidad}
- Eventos por hora: ${desglose.eventosPorHora.toFixed(1)}

Genera un mensaje de coaching de 1 a 3 frases, máximo 280 caracteres total.`;
}
