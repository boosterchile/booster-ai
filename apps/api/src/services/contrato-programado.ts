import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { empresas } from '../db/schema.js';

/**
 * ADR-079 §2 — contrato programado: solo los generadores habilitados por el
 * platform-admin pueden publicar `modalidad_carga = 'programada'` (tasa
 * menor). Se registra quién y cuándo; deshabilitar limpia ambos campos.
 */
export interface GeneradorContratoProgramado {
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
  activadoEn: empresas.contratoProgramadoActivadoEn,
  activadoPor: empresas.contratoProgramadoActivadoPor,
};

export async function listarGeneradoresContratoProgramado(
  db: Db,
): Promise<GeneradorContratoProgramado[]> {
  // rls-allowlist: vista platform-admin cross-tenant de generadores (gate requirePlatformAdmin en la ruta).
  return await db
    .select(columnas)
    .from(empresas)
    .where(eq(empresas.isGeneradorCarga, true))
    .orderBy(asc(empresas.legalName))
    .limit(500);
}

/** Devuelve la empresa actualizada, o null si no existe o no es generadora. */
export async function cambiarContratoProgramado(opts: {
  db: Db;
  empresaId: string;
  activo: boolean;
  adminEmail: string;
}): Promise<GeneradorContratoProgramado | null> {
  // rls-allowlist: acción platform-admin sobre una empresa por id (gate requirePlatformAdmin en la ruta).
  const filas = await opts.db
    .update(empresas)
    .set(
      opts.activo
        ? {
            contratoProgramadoActivadoEn: new Date(),
            contratoProgramadoActivadoPor: opts.adminEmail,
          }
        : { contratoProgramadoActivadoEn: null, contratoProgramadoActivadoPor: null },
    )
    .where(and(eq(empresas.id, opts.empresaId), eq(empresas.isGeneradorCarga, true)))
    .returning(columnas);
  return filas[0] ?? null;
}
