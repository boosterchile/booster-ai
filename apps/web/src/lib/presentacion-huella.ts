import { z } from 'zod';

/**
 * Presentación de la huella de ADR-091 tal como la entrega el API
 * (`.specs/sello-huella-toda-la-web`). La web no la calcula: la lee.
 */
export const presentacionSchema = z.enum(['primario', 'medido_teltonika', 'estimado']);

export type PresentacionHuella = z.infer<typeof presentacionSchema>;

const totalPresentacionSchema = z.object({
  certificados: z.number(),
  kgco2e: z.number(),
  ahorro_kgco2e: z.number(),
});

/** `resumen.por_presentacion` de `GET /certificates` y de los indicadores del panel. */
export const porPresentacionSchema = z.object({
  primario: totalPresentacionSchema,
  medido_teltonika: totalPresentacionSchema,
  estimado: totalPresentacionSchema,
});

export type PorPresentacion = z.infer<typeof porPresentacionSchema>;

/**
 * Un campo de cada presentación, para `TotalHuella`. Una respuesta vieja sin
 * `por_presentacion` deja todo el total en «Estimado»: no se afirma lo medido.
 */
export function campoPorPresentacion(
  por: PorPresentacion | undefined,
  campo: 'kgco2e' | 'ahorro_kgco2e' | 'certificados',
  totalSinSeparar = 0,
): Record<PresentacionHuella, number> {
  if (!por) {
    return { primario: 0, medido_teltonika: 0, estimado: totalSinSeparar };
  }
  return {
    primario: por.primario[campo],
    medido_teltonika: por.medido_teltonika[campo],
    estimado: por.estimado[campo],
  };
}
