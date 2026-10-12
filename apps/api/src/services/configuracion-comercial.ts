import {
  type ConfiguracionComercial,
  configuracionComercialSchema,
} from '@booster-ai/shared-schemas';
import { desc, eq, max, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { configuracionComercial } from '../db/schema.js';
import { getBusinessCounter } from '../observability/business-metrics.js';

/**
 * ADR-079 §3 — configuración comercial en runtime: lectura de la versión
 * publicada (con caché ≤ 60 s), historial y publicación de versiones nuevas.
 * Cada publicación es una fila nueva; una versión publicada nunca se edita.
 */

/** ADR-079 §3: un cambio en admin rige para publicaciones nuevas en ≤ 60 s. */
export const TTL_CACHE_CONFIGURACION_COMERCIAL_MS = 60_000;

const SECCIONES = ['comisiones', 'servicios', 'financiamiento', 'impuestos'] as const;
export type SeccionConfiguracion = (typeof SECCIONES)[number];

export interface VersionConfiguracionComercial {
  id: string;
  version: number;
  config: ConfiguracionComercial;
  vigenteDesde: Date;
  notaCambio: string;
  creadoPorEmail: string;
  creadoEn: Date;
}

export class SinConfiguracionPublicadaError extends Error {
  constructor() {
    super('No hay configuración comercial publicada (la migración 0059 siembra la versión 1)');
    this.name = 'SinConfiguracionPublicadaError';
  }
}

type FilaConfiguracion = typeof configuracionComercial.$inferSelect;

function aVersion(fila: FilaConfiguracion): VersionConfiguracionComercial {
  return {
    id: fila.id,
    version: fila.version,
    // El JSONB se valida al leer: una fila corrupta no llega a pricing.
    config: configuracionComercialSchema.parse(fila.config),
    vigenteDesde: fila.vigenteDesde,
    notaCambio: fila.notaCambio,
    creadoPorEmail: fila.creadoPorEmail,
    creadoEn: fila.creadoEn,
  };
}

export async function leerConfiguracionPublicada(db: Db): Promise<VersionConfiguracionComercial> {
  // rls-allowlist: configuración comercial global de plataforma (sin empresa_id).
  const filas = await db
    .select()
    .from(configuracionComercial)
    .where(eq(configuracionComercial.publicada, true))
    .limit(1);
  const fila = filas[0];
  if (!fila) {
    throw new SinConfiguracionPublicadaError();
  }
  return aVersion(fila);
}

export async function listarHistorialConfiguracion(
  db: Db,
  limite = 20,
): Promise<VersionConfiguracionComercial[]> {
  // rls-allowlist: historial de configuración global de plataforma (sin empresa_id).
  const filas = await db
    .select()
    .from(configuracionComercial)
    .orderBy(desc(configuracionComercial.version))
    .limit(limite);
  return filas.map(aVersion);
}

export function seccionesCambiadas(
  anterior: ConfiguracionComercial | null,
  nueva: ConfiguracionComercial,
): SeccionConfiguracion[] {
  return SECCIONES.filter(
    (s) => anterior === null || JSON.stringify(anterior[s]) !== JSON.stringify(nueva[s]),
  );
}

/**
 * Publica una versión nueva: la deja como única publicada y conserva las
 * anteriores intactas en el historial. Serializado con un advisory lock de
 * transacción para que publicaciones concurrentes no choquen en `version`
 * ni en el singleton.
 */
export async function publicarConfiguracionComercial(opts: {
  db: Db;
  config: ConfiguracionComercial;
  notaCambio: string;
  adminEmail: string;
}): Promise<VersionConfiguracionComercial> {
  const config = configuracionComercialSchema.parse(opts.config);
  const { nueva, anterior } = await opts.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('configuracion_comercial'))`);

    // rls-allowlist: configuración comercial global de plataforma (sin empresa_id).
    const vigente = await tx
      .select()
      .from(configuracionComercial)
      .where(eq(configuracionComercial.publicada, true))
      .limit(1);
    // rls-allowlist: configuración comercial global de plataforma (sin empresa_id).
    const maxima = await tx
      .select({ v: max(configuracionComercial.version) })
      .from(configuracionComercial);

    // rls-allowlist: configuración comercial global de plataforma (sin empresa_id).
    await tx
      .update(configuracionComercial)
      .set({ publicada: false })
      .where(eq(configuracionComercial.publicada, true));
    // rls-allowlist: configuración comercial global de plataforma (sin empresa_id).
    const insertadas = await tx
      .insert(configuracionComercial)
      .values({
        version: (maxima[0]?.v ?? 0) + 1,
        config,
        publicada: true,
        notaCambio: opts.notaCambio,
        creadoPorEmail: opts.adminEmail,
      })
      .returning();
    const insertada = insertadas[0];
    if (!insertada) {
      throw new Error('publicarConfiguracionComercial: INSERT sin fila devuelta');
    }
    return { nueva: aVersion(insertada), anterior: vigente[0]?.config ?? null };
  });

  const contador = getBusinessCounter('pricing.configuracion_comercial_publicada');
  for (const seccion of seccionesCambiadas(
    anterior === null ? null : configuracionComercialSchema.parse(anterior),
    nueva.config,
  )) {
    contador.add(1, { seccion });
  }
  return nueva;
}

export interface LectorConfiguracionComercial {
  obtener(): Promise<VersionConfiguracionComercial>;
  /** Fuerza la relectura (tras publicar en esta misma instancia). */
  invalidar(): void;
}

/**
 * Lectura en caliente con caché en memoria (ADR-079 §3). Un error de
 * lectura no se cachea: la siguiente llamada reintenta.
 */
export function crearLectorConfiguracionComercial(opts: {
  leer: () => Promise<VersionConfiguracionComercial>;
  ttlMs?: number;
  ahora?: () => number;
}): LectorConfiguracionComercial {
  const ttlMs = opts.ttlMs ?? TTL_CACHE_CONFIGURACION_COMERCIAL_MS;
  const ahora = opts.ahora ?? Date.now;
  let cache: { valor: VersionConfiguracionComercial; leidoEn: number } | null = null;

  return {
    async obtener() {
      if (cache && ahora() - cache.leidoEn < ttlMs) {
        return cache.valor;
      }
      const valor = await opts.leer();
      cache = { valor, leidoEn: ahora() };
      return valor;
    },
    invalidar() {
      cache = null;
    },
  };
}
