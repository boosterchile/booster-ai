import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { empresas } from '../db/schema.js';

/**
 * `.specs/servicios-por-empresa` — servicio de ofertas de carga por empresa
 * transportista. Apagado, la empresa no participa del matching ni ve ofertas
 * ni finanzas: opera con Booster Fleet y sus viajes propios. Lo cambia el
 * platform-admin; se registra quién y cuándo.
 */
export interface TransportistaOfertasCarga {
  empresaId: string;
  razonSocial: string;
  rut: string;
  activo: boolean;
  cambiadoEn: Date | null;
  cambiadoPor: string | null;
}

const columnas = {
  empresaId: empresas.id,
  razonSocial: empresas.legalName,
  rut: empresas.rut,
  activo: empresas.recibeOfertasCarga,
  cambiadoEn: empresas.recibeOfertasCargaCambiadoEn,
  cambiadoPor: empresas.recibeOfertasCargaCambiadoPor,
};

export async function listarTransportistasOfertasCarga(
  db: Db,
): Promise<TransportistaOfertasCarga[]> {
  // rls-allowlist: vista platform-admin cross-tenant de transportistas (gate requirePlatformAdmin en la ruta).
  return await db
    .select(columnas)
    .from(empresas)
    .where(eq(empresas.isTransportista, true))
    .orderBy(asc(empresas.legalName))
    .limit(500);
}

/** Devuelve la empresa actualizada, o null si no existe o no es transportista. */
export async function cambiarOfertasCarga(opts: {
  db: Db;
  empresaId: string;
  activo: boolean;
  adminEmail: string;
}): Promise<TransportistaOfertasCarga | null> {
  // rls-allowlist: acción platform-admin sobre una empresa por id (gate requirePlatformAdmin en la ruta).
  const filas = await opts.db
    .update(empresas)
    .set({
      recibeOfertasCarga: opts.activo,
      recibeOfertasCargaCambiadoEn: new Date(),
      recibeOfertasCargaCambiadoPor: opts.adminEmail,
    })
    .where(and(eq(empresas.id, opts.empresaId), eq(empresas.isTransportista, true)))
    .returning(columnas);
  return filas[0] ?? null;
}
