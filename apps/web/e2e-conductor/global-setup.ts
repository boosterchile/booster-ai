import { reseedConductorE2e } from './helpers.js';

/**
 * Corre el seed T2 contra Postgres + Auth emulator ANTES de los tests.
 * Falla con mensaje claro si falta DATABASE_URL o el emulador.
 */
export default function globalSetup(): void {
  reseedConductorE2e();
}
