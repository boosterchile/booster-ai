#!/usr/bin/env node
/**
 * @booster-ai/repo-checks — medir-ci-p95
 *
 * Mide el tiempo de reloj de CI por PR con la API de Actions (TRL 10,
 * criterio T10-14: p95 ≤ 10 min sobre los últimos 50 PRs).
 *
 * Definición:
 *   - Un PR = una rama con al menos una corrida de `ci.yml` por `pull_request`
 *     que terminó en `success` o `failure` (las canceladas por concurrencia y
 *     las omitidas no cuentan).
 *   - Se toma la última corrida de `ci.yml` de cada rama y su commit.
 *   - Los workflows de PR (`ci.yml`, `e2e-pr.yml`, `security.yml`) corren en
 *     paralelo sobre el mismo commit; el reloj del PR es el del más lento.
 *   - La duración de una corrida es `updated_at - run_started_at`: la del
 *     último intento. Una re-ejecución manual no suma la espera hasta que
 *     alguien la pidió.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/repo-checks/medir-ci-p95.mjs
 *   GITHUB_TOKEN=... node scripts/repo-checks/medir-ci-p95.mjs --prs 50 --paginas 3 --output docs/perf/ci-p95-YYYY-MM-DD.md
 *
 * Exit codes:
 *   0 = p95 ≤ 10 min
 *   1 = p95 > 10 min
 *   2 = error de uso, de la API o sin corridas
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';

export const UMBRAL_P95_MIN = 10;
export const WORKFLOWS_PR = ['ci.yml', 'e2e-pr.yml', 'security.yml'];
const WORKFLOW_PRINCIPAL = 'ci.yml';
const CONCLUSIONES_VALIDAS = new Set(['success', 'failure']);

/** Percentil con interpolación lineal entre posiciones (método R-7). */
export function percentil(valores, q) {
  if (valores.length === 0) {
    return Number.NaN;
  }
  const xs = [...valores].sort((a, b) => a - b);
  const k = (xs.length - 1) * q;
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, xs.length - 1);
  return xs[lo] + (xs[hi] - xs[lo]) * (k - lo);
}

const minutos = (run) => (Date.parse(run.updated_at) - Date.parse(run.run_started_at)) / 60_000;
const workflowDe = (run) => run.path.split('/').pop();

export function duracionesPorPr(runs, limite) {
  const validas = runs.filter((r) => CONCLUSIONES_VALIDAS.has(r.conclusion));
  const porSha = new Map();
  for (const r of validas) {
    const lista = porSha.get(r.head_sha) ?? [];
    lista.push(r);
    porSha.set(r.head_sha, lista);
  }
  const principales = validas
    .filter((r) => workflowDe(r) === WORKFLOW_PRINCIPAL)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const filas = [];
  const vistas = new Set();
  for (const r of principales) {
    if (vistas.has(r.head_branch)) {
      continue;
    }
    vistas.add(r.head_branch);
    const masLenta = (porSha.get(r.head_sha) ?? [r]).reduce((a, b) =>
      minutos(b) > minutos(a) ? b : a,
    );
    filas.push({
      rama: r.head_branch,
      sha: r.head_sha,
      creada: r.created_at,
      minutos: minutos(masLenta),
      workflow: workflowDe(masLenta),
    });
    if (filas.length === limite) {
      break;
    }
  }
  return filas;
}

const redondear = (x) => Math.round(x * 10) / 10;

export function resumen(filas) {
  const xs = filas.map((f) => f.minutos);
  const p95 = redondear(percentil(xs, 0.95));
  return {
    n: xs.length,
    p50: redondear(percentil(xs, 0.5)),
    p95,
    max: redondear(Math.max(...xs)),
    cumple: p95 <= UMBRAL_P95_MIN,
  };
}

const coma = (x) => redondear(x).toFixed(1).replace('.', ',');

export function renderMarkdown({ filas, resumen: r, repo, medidoEn }) {
  const masLentas = [...filas].sort((a, b) => b.minutos - a.minutos).slice(0, 10);
  const desde = filas.map((f) => f.creada).sort()[0] ?? '';
  return [
    `# Tiempo de CI por PR — ${medidoEn}`,
    '',
    `Criterio T10-14 (ADR-082): p95 del tiempo de reloj de CI por PR ≤ ${UMBRAL_P95_MIN} min sobre los últimos 50 PRs, medido con la API de Actions.`,
    '',
    `- Repositorio: \`${repo}\``,
    `- PRs medidos: ${r.n} (corridas desde ${desde.slice(0, 10)})`,
    `- p50: ${coma(r.p50)} min · **p95: ${coma(r.p95)} min** · máximo: ${coma(r.max)} min`,
    `- Resultado: ${r.cumple ? '**Cumple**' : '**No cumple**'} (umbral ${UMBRAL_P95_MIN} min)`,
    '',
    '## Método',
    '',
    `- Por cada rama con corridas de \`${WORKFLOW_PRINCIPAL}\` por \`pull_request\` (\`success\` o \`failure\`), se toma la última corrida y su commit.`,
    `- El reloj del PR es el del workflow más lento de ese commit entre ${WORKFLOWS_PR.map((w) => `\`${w}\``).join(', ')}, que corren en paralelo.`,
    '- La duración de una corrida es `updated_at - run_started_at` (último intento). Las canceladas por concurrencia no cuentan.',
    '- Reproducible con `GITHUB_TOKEN=... node scripts/repo-checks/medir-ci-p95.mjs`.',
    '',
    '## Las 10 más lentas',
    '',
    '| Rama | Commit | Workflow más lento | Minutos |',
    '| --- | --- | --- | --- |',
    ...masLentas.map(
      (f) => `| \`${f.rama}\` | \`${f.sha.slice(0, 7)}\` | ${f.workflow} | ${coma(f.minutos)} |`,
    ),
    '',
  ].join('\n');
}

function entero(flag, valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${flag} espera un entero positivo, llegó "${valor}"`);
  }
  return n;
}

export function parseArgs(argv) {
  const args = { repo: 'boosterchile/booster-ai', prs: 50, paginas: 3, output: null };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, valor] = [argv[i], argv[i + 1]];
    if (flag === '--repo') {
      args.repo = valor;
    } else if (flag === '--prs') {
      args.prs = entero(flag, valor);
    } else if (flag === '--paginas') {
      args.paginas = entero(flag, valor);
    } else if (flag === '--output') {
      args.output = valor;
    } else {
      throw new Error(`argumento desconocido: ${flag}`);
    }
  }
  return args;
}

export async function obtenerRuns({ repo, paginas, token, fetchImpl }) {
  const runs = [];
  for (const workflow of WORKFLOWS_PR) {
    for (let pagina = 1; pagina <= paginas; pagina++) {
      const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?event=pull_request&status=completed&per_page=100&page=${pagina}`;
      const res = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) {
        throw new Error(`API de Actions respondió ${res.status} para ${workflow} página ${pagina}`);
      }
      const cuerpo = await res.json();
      runs.push(...(cuerpo.workflow_runs ?? []));
    }
  }
  return runs;
}

export async function main(
  argv,
  {
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
    fetchImpl = globalThis.fetch,
    hoy = () => new Date().toISOString().slice(0, 10),
  } = {},
) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    stderr.write('medir-ci-p95: falta GITHUB_TOKEN (lectura de Actions)\n');
    return 2;
  }
  try {
    const args = parseArgs(argv);
    const runs = await obtenerRuns({ repo: args.repo, paginas: args.paginas, token, fetchImpl });
    const filas = duracionesPorPr(runs, args.prs);
    if (filas.length === 0) {
      stderr.write('medir-ci-p95: sin corridas de ci.yml por pull_request\n');
      return 2;
    }
    const r = resumen(filas);
    const md = renderMarkdown({ filas, resumen: r, repo: args.repo, medidoEn: hoy() });
    if (args.output) {
      writeFileSync(args.output, md);
    }
    stdout.write(md);
    return r.cumple ? 0 : 1;
  } catch (err) {
    stderr.write(`medir-ci-p95: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exit(await main(process.argv.slice(2)));
}
