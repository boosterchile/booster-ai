import { check, fail } from 'k6';
import http from 'k6/http';

/**
 * t10.k6.js — load test del api para el criterio T10-19 (ADR-082).
 *
 * Criterio: en un entorno que NO es prod, 50 RPS sostenidos y 200 de pico con
 * p95 ≤ 500 ms y p99 ≤ 1,5 s. Los umbrales de abajo son ese criterio; k6 sale
 * con código ≠ 0 si alguno no se cumple.
 *
 * Escenarios (llegadas por segundo, no VUs: la tasa no depende de la latencia):
 *   - sostenido: 50 RPS durante SOSTENIDO_MIN (10 min por omisión).
 *   - pico: después del sostenido, sube de 50 a 200 RPS en 1 min, mantiene
 *     200 RPS durante PICO_MIN (3 min por omisión) y baja.
 *
 * Mezcla de requests (pesos sobre 100):
 *   - 10 GET /health          (liveness, sin DB)
 *   - 10 GET /ready           (ping a Postgres)
 *   - 20 GET /feature-flags   (público, lee config)
 *   - 30 GET /me              (Firebase + users + memberships)
 *   - 30 GET /me/assignments  (lectura real de un conductor)
 * El tracking público queda fuera: tiene rate limit por IP y un generador de
 * carga desde una sola IP mediría el limitador, no el api.
 *
 * Env:
 *   BASE_URL       URL del api no-prod (obligatoria; se rechaza api.boosterchile.com).
 *   ID_TOKEN       Firebase ID token de un conductor de prueba del entorno
 *                  (dura 1 h: alcanza para la corrida completa).
 *   SOLO_PUBLICO   "1" para correr solo los endpoints públicos (sin ID_TOKEN).
 *   SOSTENIDO_MIN  minutos del sostenido (10).
 *   PICO_MIN       minutos a 200 RPS (3).
 *
 * Run:
 *   BASE_URL=https://api.staging.example ID_TOKEN=... \
 *     k6 run --summary-export=load-t10.json apps/api/test/load/t10.k6.js
 */

// biome-ignore lint/correctness/noUndeclaredVariables: __ENV is a k6 runtime global
const ENV = __ENV;
const BASE_URL = ENV.BASE_URL || '';
const ID_TOKEN = ENV.ID_TOKEN || '';
const SOLO_PUBLICO = ENV.SOLO_PUBLICO === '1';
const SOSTENIDO_MIN = Number(ENV.SOSTENIDO_MIN || 10);
const PICO_MIN = Number(ENV.PICO_MIN || 3);

export const options = {
  // p(99) en el resumen: el criterio lo exige y k6 no lo muestra por omisión.
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    sostenido: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: `${SOSTENIDO_MIN}m`,
      preAllocatedVUs: 100,
      maxVUs: 400,
      tags: { fase: 'sostenido' },
    },
    pico: {
      executor: 'ramping-arrival-rate',
      startTime: `${SOSTENIDO_MIN}m`,
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 300,
      maxVUs: 1200,
      stages: [
        { target: 200, duration: '1m' },
        { target: 200, duration: `${PICO_MIN}m` },
        { target: 0, duration: '30s' },
      ],
      tags: { fase: 'pico' },
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<=500', 'p(99)<=1500'],
    'http_req_duration{fase:sostenido}': ['p(95)<=500', 'p(99)<=1500'],
    'http_req_duration{fase:pico}': ['p(95)<=500', 'p(99)<=1500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    // Si k6 no logra sostener la tasa (faltan VUs), la corrida no prueba nada.
    dropped_iterations: ['count<50'],
  },
};

const PUBLICOS = [
  { peso: 10, path: '/health' },
  { peso: 10, path: '/ready' },
  { peso: 20, path: '/feature-flags' },
];
const AUTENTICADOS = [
  { peso: 30, path: '/me' },
  { peso: 30, path: '/me/assignments' },
];
const MEZCLA = SOLO_PUBLICO ? PUBLICOS : [...PUBLICOS, ...AUTENTICADOS];
const PESO_TOTAL = MEZCLA.reduce((s, r) => s + r.peso, 0);

export function setup() {
  if (!BASE_URL) {
    fail('BASE_URL es obligatoria');
  }
  if (/api\.boosterchile\.com/.test(BASE_URL)) {
    fail('T10-19 se corre en un entorno que no es prod: BASE_URL apunta a producción');
  }
  if (!SOLO_PUBLICO && !ID_TOKEN) {
    fail('Falta ID_TOKEN (o SOLO_PUBLICO=1 para una corrida sin endpoints autenticados)');
  }
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    fail(`/health respondió ${res.status}: el entorno no está arriba`);
  }
  if (!SOLO_PUBLICO) {
    const me = http.get(`${BASE_URL}/me`, { headers: { Authorization: `Bearer ${ID_TOKEN}` } });
    if (me.status !== 200) {
      fail(`/me respondió ${me.status}: el ID_TOKEN no sirve en este entorno`);
    }
  }
}

function elegir() {
  let x = Math.random() * PESO_TOTAL;
  for (const r of MEZCLA) {
    x -= r.peso;
    if (x < 0) {
      return r;
    }
  }
  return MEZCLA[MEZCLA.length - 1];
}

export default function () {
  const r = elegir();
  const autenticado = r.path.startsWith('/me');
  const res = http.get(`${BASE_URL}${r.path}`, {
    headers: autenticado ? { Authorization: `Bearer ${ID_TOKEN}` } : {},
    tags: { endpoint: r.path },
  });
  check(res, { 'status 200': (x) => x.status === 200 });
}
