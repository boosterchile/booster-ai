import type { Logger } from '@booster-ai/logger';
import {
  type ResultadoRanking,
  type SolicitudRanking,
  hashRanking,
  rankearCandidatos,
} from '@booster-ai/matching-algorithm';
import { respuestaRankingSchema } from '@booster-ai/shared-schemas';
import { GoogleAuth } from 'google-auth-library';

/**
 * T10-21 — ranking de candidatos entre el api (en proceso) y
 * apps/matching-engine (`POST /ranking`). `runMatching` arma la solicitud con
 * sus queries y le pide el ranking a este rankeador; las offers y las
 * transiciones de estado siguen en el api.
 * Spec: `.specs/matching-engine-t10-21/spec.md`.
 */
export type ModoMatching = 'local' | 'sombra' | 'microservicio';

export function modoMatching(flags: { viaMicroservicio: boolean; sombra: boolean }): ModoMatching {
  if (flags.viaMicroservicio) {
    return 'microservicio';
  }
  return flags.sombra ? 'sombra' : 'local';
}

export type RankearRemoto = (solicitud: SolicitudRanking) => Promise<ResultadoRanking>;

/** Timeout del ranking remoto: corre dentro de la transacción del matching. */
export const TIMEOUT_RANKING_REMOTO_MS = 3_000;

interface IdTokenHttpClient {
  request<T>(opts: {
    url: string;
    method: 'POST';
    data: unknown;
    timeout: number;
    headers: Record<string, string>;
  }): Promise<{ status: number; data: T }>;
}

/**
 * Cliente de matching-engine con ID token de Google (Cloud Run IAM +
 * verificación del token en el servicio). Mismo patrón que el bot → api.
 */
export function crearClienteMatchingEngine(opts: {
  url: string;
  obtenerCliente?: () => Promise<IdTokenHttpClient>;
}): RankearRemoto {
  const obtenerCliente =
    opts.obtenerCliente ??
    (() => {
      const auth = new GoogleAuth();
      // IdTokenClient.request es genérico sobre GaxiosOptions; el body de la
      // respuesta igual pasa por Zod (respuestaRankingSchema) antes de usarse.
      return async () => (await auth.getIdTokenClient(opts.url)) as IdTokenHttpClient;
    })();
  const base = opts.url.replace(/\/$/, '');

  return async (solicitud) => {
    const cliente = await obtenerCliente();
    const respuesta = await cliente.request<unknown>({
      url: `${base}/ranking`,
      method: 'POST',
      data: solicitud,
      timeout: TIMEOUT_RANKING_REMOTO_MS,
      headers: { 'content-type': 'application/json' },
    });
    if (respuesta.status !== 200) {
      throw new Error(`matching-engine respondió ${respuesta.status}`);
    }
    return respuestaRankingSchema.parse(respuesta.data);
  };
}

export interface RankeadorMatching {
  /** Ranking que decide las offers (dentro de la transacción). */
  rankear(solicitud: SolicitudRanking): Promise<ResultadoRanking>;
  /** Hook post-commit: en sombra compara contra el remoto, fire-and-forget. */
  trasCommit(solicitud: SolicitudRanking, decidido: ResultadoRanking): void;
}

/** Ranking en proceso, sin remoto: modo por defecto y fallback. */
export const rankeadorLocal: RankeadorMatching = {
  rankear: async (solicitud) => rankearCandidatos(solicitud),
  trasCommit: () => undefined,
};

/**
 * Un ranking remoto solo es aceptable si cada offer apunta a un par
 * (empresa, vehículo) que el api envió como candidato.
 */
function verificarCandidatos(solicitud: SolicitudRanking, resultado: ResultadoRanking): void {
  const validos = new Set(solicitud.candidatos.map((c) => `${c.empresaId}:${c.vehicleId}`));
  for (const c of resultado.top) {
    if (!validos.has(`${c.empresaId}:${c.vehicleId}`)) {
      throw new Error(`ranking remoto con candidato desconocido ${c.empresaId}:${c.vehicleId}`);
    }
  }
}

export function crearRankeadorMatching(opts: {
  modo: ModoMatching;
  remoto: RankearRemoto | null;
  logger: Logger;
}): RankeadorMatching {
  const { modo, remoto, logger } = opts;

  if (modo === 'local') {
    return rankeadorLocal;
  }
  if (!remoto) {
    logger.warn({ modo }, 'matching sin MATCHING_ENGINE_URL: ranking local');
    return rankeadorLocal;
  }

  if (modo === 'sombra') {
    return {
      rankear: rankeadorLocal.rankear,
      trasCommit(solicitud, decidido) {
        const hashLocal = hashRanking(decidido.top);
        void remoto(solicitud)
          .then((r) => {
            const hashRemoto = hashRanking(r.top);
            if (hashRemoto === hashLocal) {
              logger.info(
                { hash: hashLocal, algoritmo: solicitud.algoritmo },
                'matching sombra coincide',
              );
              return;
            }
            logger.warn(
              {
                hashLocal,
                hashRemoto,
                algoritmo: solicitud.algoritmo,
                local: decidido.top,
                remoto: r.top,
              },
              'matching sombra diverge',
            );
          })
          .catch((err: unknown) => {
            logger.error({ err, algoritmo: solicitud.algoritmo }, 'matching sombra error');
          });
      },
    };
  }

  return {
    async rankear(solicitud) {
      const inicio = Date.now();
      try {
        const r = await remoto(solicitud);
        verificarCandidatos(solicitud, r);
        logger.info(
          { algoritmo: r.algoritmo, ofertas: r.top.length, latenciaMs: Date.now() - inicio },
          'matching ranking remoto',
        );
        return r;
      } catch (err) {
        // El matching del usuario no se pierde: misma función en proceso.
        logger.error(
          { err, algoritmo: solicitud.algoritmo, latenciaMs: Date.now() - inicio },
          'matching remoto fallo, fallback local',
        );
        return rankearCandidatos(solicitud);
      }
    },
    trasCommit: () => undefined,
  };
}
