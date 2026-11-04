import { describe, expect, it, vi } from 'vitest';
import {
  UMBRAL_P95_MIN,
  WORKFLOWS_PR,
  duracionesPorPr,
  main,
  obtenerRuns,
  parseArgs,
  percentil,
  renderMarkdown,
  resumen,
} from './medir-ci-p95.mjs';

/** Corrida de Actions con lo mínimo que usa el script. */
function run({
  id,
  rama,
  sha = `sha-${rama}`,
  workflow = 'ci.yml',
  creada = '2026-10-01T10:00:00Z',
  inicio = creada,
  fin,
  conclusion = 'success',
}) {
  return {
    id,
    head_branch: rama,
    head_sha: sha,
    path: `.github/workflows/${workflow}`,
    created_at: creada,
    run_started_at: inicio,
    updated_at: fin,
    conclusion,
  };
}

describe('percentil', () => {
  it('interpola linealmente entre posiciones', () => {
    expect(percentil([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentil([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8);
    expect(percentil([7], 0.95)).toBe(7);
  });

  it('no depende del orden de entrada', () => {
    expect(percentil([5, 1, 4, 2, 3], 0.95)).toBeCloseTo(4.8);
  });

  it('lista vacía → NaN', () => {
    expect(percentil([], 0.95)).toBeNaN();
  });
});

describe('duracionesPorPr', () => {
  it('toma la última corrida de ci.yml por rama y el workflow más lento de ese commit', () => {
    const runs = [
      // Rama a: la última corrida (sha a2) dura 6 min en ci.yml y 8 en e2e-pr.yml.
      run({
        id: 1,
        rama: 'a',
        sha: 'a1',
        creada: '2026-10-01T09:00:00Z',
        fin: '2026-10-01T09:20:00Z',
      }),
      run({
        id: 2,
        rama: 'a',
        sha: 'a2',
        creada: '2026-10-02T10:00:00Z',
        fin: '2026-10-02T10:06:00Z',
      }),
      run({
        id: 3,
        rama: 'a',
        sha: 'a2',
        workflow: 'e2e-pr.yml',
        creada: '2026-10-02T10:00:00Z',
        fin: '2026-10-02T10:08:00Z',
      }),
      // Rama b: 4 min.
      run({ id: 4, rama: 'b', creada: '2026-10-01T12:00:00Z', fin: '2026-10-01T12:04:00Z' }),
    ];
    expect(duracionesPorPr(runs, 50)).toEqual([
      { rama: 'a', sha: 'a2', creada: '2026-10-02T10:00:00Z', minutos: 8, workflow: 'e2e-pr.yml' },
      { rama: 'b', sha: 'sha-b', creada: '2026-10-01T12:00:00Z', minutos: 4, workflow: 'ci.yml' },
    ]);
  });

  it('una re-ejecución cuenta por la duración del intento, no por la espera hasta re-ejecutar', () => {
    const runs = [
      run({
        id: 1,
        rama: 'a',
        sha: 'a1',
        creada: '2026-10-02T10:00:00Z',
        fin: '2026-10-02T10:05:00Z',
      }),
      // Re-ejecutada 3 horas después: el intento dura 2 min.
      run({
        id: 2,
        rama: 'a',
        sha: 'a1',
        workflow: 'security.yml',
        creada: '2026-10-02T10:00:00Z',
        inicio: '2026-10-02T13:00:00Z',
        fin: '2026-10-02T13:02:00Z',
      }),
    ];
    expect(duracionesPorPr(runs, 50)[0]?.minutos).toBe(5);
  });

  it('ignora corridas canceladas y omitidas de ci.yml y de los demás workflows', () => {
    const runs = [
      run({
        id: 1,
        rama: 'a',
        sha: 'a2',
        creada: '2026-10-02T10:00:00Z',
        fin: '2026-10-02T10:30:00Z',
        conclusion: 'cancelled',
      }),
      run({
        id: 2,
        rama: 'a',
        sha: 'a1',
        creada: '2026-10-01T10:00:00Z',
        fin: '2026-10-01T10:05:00Z',
      }),
      run({
        id: 3,
        rama: 'a',
        sha: 'a1',
        workflow: 'e2e-pr.yml',
        creada: '2026-10-01T10:00:00Z',
        fin: '2026-10-01T11:00:00Z',
        conclusion: 'cancelled',
      }),
    ];
    expect(duracionesPorPr(runs, 50)).toEqual([
      { rama: 'a', sha: 'a1', creada: '2026-10-01T10:00:00Z', minutos: 5, workflow: 'ci.yml' },
    ]);
  });

  it('las fallidas cuentan: el reloj corre igual', () => {
    const runs = [
      run({
        id: 1,
        rama: 'a',
        creada: '2026-10-01T10:00:00Z',
        fin: '2026-10-01T10:07:00Z',
        conclusion: 'failure',
      }),
    ];
    expect(duracionesPorPr(runs, 50)[0]?.minutos).toBe(7);
  });

  it('corta en el límite de PRs, de la más reciente a la más antigua', () => {
    const runs = ['a', 'b', 'c'].map((rama, i) =>
      run({
        id: i,
        rama,
        creada: `2026-10-0${i + 1}T10:00:00Z`,
        fin: `2026-10-0${i + 1}T10:0${i + 1}:00Z`,
      }),
    );
    expect(duracionesPorPr(runs, 2).map((f) => f.rama)).toEqual(['c', 'b']);
  });
});

describe('resumen', () => {
  it('p50, p95, máximo y si cumple el umbral', () => {
    const filas = [3, 4, 5, 6, 12].map((minutos, i) => ({
      rama: `r${i}`,
      sha: 's',
      creada: '2026-10-01T10:00:00Z',
      minutos,
      workflow: 'ci.yml',
    }));
    expect(resumen(filas)).toEqual({ n: 5, p50: 5, p95: 10.8, max: 12, cumple: false });
    expect(UMBRAL_P95_MIN).toBe(10);
  });
});

describe('renderMarkdown', () => {
  it('incluye el resultado, el criterio y las corridas más lentas', () => {
    const filas = [
      {
        rama: 'lenta',
        sha: 'abc1234def',
        creada: '2026-10-01T10:00:00Z',
        minutos: 8.25,
        workflow: 'ci.yml',
      },
      {
        rama: 'rapida',
        sha: 'f00',
        creada: '2026-10-02T10:00:00Z',
        minutos: 4,
        workflow: 'e2e-pr.yml',
      },
    ];
    const md = renderMarkdown({
      filas,
      resumen: resumen(filas),
      repo: 'o/r',
      medidoEn: '2026-10-09',
    });
    expect(md).toContain('p95');
    expect(md).toContain('**Cumple**');
    expect(md).toContain('| `lenta` | `abc1234` | ci.yml | 8,3 |');
    expect(md).toContain('o/r');
  });

  it('declara el incumplimiento', () => {
    const filas = [
      { rama: 'x', sha: 's', creada: '2026-10-01T10:00:00Z', minutos: 11, workflow: 'ci.yml' },
    ];
    expect(
      renderMarkdown({ filas, resumen: resumen(filas), repo: 'o/r', medidoEn: '2026-10-09' }),
    ).toContain('**No cumple**');
  });
});

describe('parseArgs', () => {
  it('valores por omisión y overrides', () => {
    expect(parseArgs([])).toEqual({
      repo: 'boosterchile/booster-ai',
      prs: 50,
      paginas: 3,
      output: null,
    });
    expect(
      parseArgs(['--repo', 'o/r', '--prs', '20', '--paginas', '2', '--output', 'x.md']),
    ).toEqual({
      repo: 'o/r',
      prs: 20,
      paginas: 2,
      output: 'x.md',
    });
  });

  it('número inválido → error', () => {
    expect(() => parseArgs(['--prs', 'muchos'])).toThrow(/--prs/);
  });
});

describe('obtenerRuns', () => {
  it('pide las corridas completadas de pull_request de cada workflow y página', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ workflow_runs: [{ id: 1 }] }),
    }));
    const runs = await obtenerRuns({ repo: 'o/r', paginas: 2, token: 't', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(WORKFLOWS_PR.length * 2);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://api.github.com/repos/o/r/actions/workflows/ci.yml/runs?event=pull_request&status=completed&per_page=100&page=1',
    );
    expect(init.headers.Authorization).toBe('Bearer t');
    expect(runs).toHaveLength(WORKFLOWS_PR.length * 2);
  });

  it('una respuesta no OK falla con el código', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    await expect(obtenerRuns({ repo: 'o/r', paginas: 1, token: 't', fetchImpl })).rejects.toThrow(
      /403/,
    );
  });
});

describe('main', () => {
  const salida = () => {
    const partes = [];
    return { write: (s) => partes.push(s), texto: () => partes.join('') };
  };

  it('sin GITHUB_TOKEN → 2', async () => {
    const stderr = salida();
    expect(await main([], { env: {}, stdout: salida(), stderr, fetchImpl: vi.fn() })).toBe(2);
    expect(stderr.texto()).toContain('GITHUB_TOKEN');
  });

  it('p95 dentro del umbral → 0 y escribe el informe', async () => {
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({
        workflow_runs:
          url.includes('/ci.yml/') && url.endsWith('page=1')
            ? [
                run({
                  id: 1,
                  rama: 'a',
                  creada: '2026-10-01T10:00:00Z',
                  fin: '2026-10-01T10:05:00Z',
                }),
              ]
            : [],
      }),
    }));
    const stdout = salida();
    const codigo = await main(['--paginas', '1'], {
      env: { GITHUB_TOKEN: 't' },
      stdout,
      stderr: salida(),
      fetchImpl,
      hoy: () => '2026-10-09',
    });
    expect(codigo).toBe(0);
    expect(stdout.texto()).toContain('**Cumple**');
  });

  it('p95 sobre el umbral → 1', async () => {
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({
        workflow_runs:
          url.includes('/ci.yml/') && url.endsWith('page=1')
            ? [
                run({
                  id: 1,
                  rama: 'a',
                  creada: '2026-10-01T10:00:00Z',
                  fin: '2026-10-01T10:15:00Z',
                }),
              ]
            : [],
      }),
    }));
    const codigo = await main(['--paginas', '1'], {
      env: { GITHUB_TOKEN: 't' },
      stdout: salida(),
      stderr: salida(),
      fetchImpl,
      hoy: () => '2026-10-09',
    });
    expect(codigo).toBe(1);
  });

  it('sin corridas → 2', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ workflow_runs: [] }),
    }));
    const stderr = salida();
    const codigo = await main(['--paginas', '1'], {
      env: { GITHUB_TOKEN: 't' },
      stdout: salida(),
      stderr,
      fetchImpl,
    });
    expect(codigo).toBe(2);
    expect(stderr.texto()).toContain('sin corridas');
  });

  it('un error de la API → 2 con el mensaje', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const stderr = salida();
    expect(
      await main([], { env: { GITHUB_TOKEN: 't' }, stdout: salida(), stderr, fetchImpl }),
    ).toBe(2);
    expect(stderr.texto()).toContain('500');
  });
});
