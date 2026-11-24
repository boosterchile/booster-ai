import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Guarda de «ejecución directa» para los jobs que también se importan desde el
 * api (ver .specs/jobs-autoejecucion-en-bundle).
 *
 * Comparar solo `import.meta.url` con `process.argv[1]` no alcanza: tsup
 * incluye en `dist/main.js` los jobs que importa `routes/admin-jobs.ts`, y ahí
 * `import.meta.url` es la URL de `main.js`, igual que `argv[1]`. La comparación
 * daba verdadero y el job corría en cada arranque del api.
 *
 * Por eso se exige además que el archivo ejecutado se llame como el job.
 *
 * @param metaUrl `import.meta.url` del módulo del job.
 * @param argv1 `process.argv[1]`: el archivo con que se lanzó el proceso.
 * @param nombreJob Nombre del archivo del job, sin extensión.
 */
export function esEjecucionDirecta(
  metaUrl: string,
  argv1: string | undefined,
  nombreJob: string,
): boolean {
  if (argv1 === undefined) {
    return false;
  }
  if (basename(argv1, extname(argv1)) !== nombreJob) {
    return false;
  }
  return pathToFileURL(argv1).href === metaUrl;
}
