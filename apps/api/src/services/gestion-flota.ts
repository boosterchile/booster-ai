import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { empresas } from '../db/schema.js';

/**
 * ADR-079 §4 — plan de transportista con gestión de flota: la suscripción
 * se cobra con la tarifa por camión de gestión de flota. Lo activa el
 * platform-admin por empresa; se registra quién y cuándo, y desactivar
 * limpia ambos campos (vuelve al plan base).
 */
export interface TransportistaGestionFlota {
  empresaId: string;
  razonSocial: string;
  rut: string;
  activadoEn: Date | null;
  activadoPor: string | null;
}

const columnas = {
  empresaId: empresas.id,
  razonSocial: empresas.legalName,
  rut: empresas.rut,
  activadoEn: empresas.gestionFlotaActivadaEn,
  activadoPor: empresas.gestionFlotaActivadaPor,
};

export async function listarTransportistasGestionFlota(
  db: Db,
): Promise<TransportistaGestionFlota[]> {
  // rls-allowlist: vista platform-admin cross-tenant de transportistas (gate requirePlatformAdmin en la ruta).
  return await db
    .select(columnas)
    .from(empresas)
    .where(eq(empresas.isTransportista, true))
    .orderBy(asc(empresas.legalName))
    .limit(500);
}

/** Devuelve la empresa actualizada, o null si no existe o no es transportista. */
export async function cambiarGestionFlota(opts: {
  db: Db;
  empresaId: string;
  activo: boolean;
  adminEmail: string;
}): Promise<TransportistaGestionFlota | null> {
  // rls-allowlist: acción platform-admin sobre una empresa por id (gate requirePlatformAdmin en la ruta).
  const filas = await opts.db
    .update(empresas)
    .set(
      opts.activo
        ? { gestionFlotaActivadaEn: new Date(), gestionFlotaActivadaPor: opts.adminEmail }
        : { gestionFlotaActivadaEn: null, gestionFlotaActivadaPor: null },
    )
    .where(and(eq(empresas.id, opts.empresaId), eq(empresas.isTransportista, true)))
    .returning(columnas);
  return filas[0] ?? null;
}
