import { z } from 'zod';

/**
 * CONTRATO CANÓNICO de `POST /ranking` de apps/matching-engine (T10-21,
 * `.specs/matching-engine-t10-21/spec.md`). Productor: apps/api
 * (`runMatching` vía el enrutador de ranking). Espeja `SolicitudRanking` /
 * `ResultadoRanking` de @booster-ai/matching-algorithm; la paridad la fija
 * el test de contrato del enrutador del api.
 */
const MAX_CANDIDATOS = 1000;

const unidad = z.number().min(0).max(1);
const conteo = z.number().int().min(0);

const candidatoV1Schema = z.object({
  empresaId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  vehicleCapacityKg: z.number().positive(),
});

const candidatoV2Schema = candidatoV1Schema.extend({
  tripActivoDestinoRegionMatch: z.boolean(),
  tripsRecientes: z.object({ totalUltimos7d: conteo, matchRegionalUltimos7d: conteo }),
  ofertasUltimos90d: z.object({ totales: conteo, aceptadas: conteo }),
  tierBoost: unidad,
});

const base = {
  cargoWeightKg: z.number().min(0),
  maxOfertas: z.number().int().min(1).max(50),
};

export const solicitudRankingSchema = z.discriminatedUnion('algoritmo', [
  z.object({
    algoritmo: z.literal('v1'),
    ...base,
    candidatos: z.array(candidatoV1Schema).max(MAX_CANDIDATOS),
  }),
  z.object({
    algoritmo: z.literal('v2'),
    ...base,
    originRegionCode: z.string().min(1),
    pesos: z.object({ capacidad: unidad, backhaul: unidad, reputacion: unidad, tier: unidad }),
    candidatos: z.array(candidatoV2Schema).max(MAX_CANDIDATOS),
  }),
]);

export type SolicitudRankingDto = z.infer<typeof solicitudRankingSchema>;

export const respuestaRankingSchema = z.object({
  algoritmo: z.enum(['v1', 'v2']),
  candidatosEvaluados: conteo,
  top: z.array(
    z.object({
      empresaId: z.string().uuid(),
      vehicleId: z.string().uuid(),
      vehicleCapacityKg: z.number().positive(),
      score: unidad,
      scoreInt: z.number().int().min(0).max(1000),
      components: z
        .object({ capacidad: unidad, backhaul: unidad, reputacion: unidad, tier: unidad })
        .optional(),
      backhaulSignal: z.enum(['active_trip_match', 'recent_history_match', 'no_signal']).optional(),
    }),
  ),
});

export type RespuestaRankingDto = z.infer<typeof respuestaRankingSchema>;
