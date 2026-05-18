import { check } from 'k6';
import http from 'k6/http';

/**
 * smoke.k6.js — minimal k6 script for the load-test plumbing introduced
 * in T8 of sprint S0 (production-readiness).
 *
 * Verifica que (a) k6 está instalado, (b) el script compila, (c) puede
 * pegarle al /health del api. NO mide nada relevante — el suite real
 * se construye en S8 (SC-18 de la spec maestra production-readiness).
 *
 * Run:
 *   pnpm --filter @booster-ai/api load-test:smoke
 *   # o directo:
 *   BASE_URL=http://localhost:3000 k6 run apps/api/test/load/smoke.k6.js
 *
 * Throwaway por diseño: S8 reescribe este folder con el suite completo
 * (50 RPS sostenido api, 200 RPS pico, 1000+ TCP gateway). Ver ADR-047.
 */

// __ENV es global de runtime k6; biome no lo conoce por default.
// biome-ignore lint/correctness/noUndeclaredVariables: __ENV is a k6 runtime global
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    // El smoke no enforce performance todavía. Threshold trivial para
    // validar la plomería: 100% de los requests deben ser http 200.
    'checks{check:status-200}': ['rate==1.0'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/health`);
  check(res, { 'status-200': (r) => r.status === 200 }, { check: 'status-200' });
}
