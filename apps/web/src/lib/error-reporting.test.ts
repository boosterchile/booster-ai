import * as Sentry from '@sentry/react';
import { createTransport } from '@sentry/react';
import type { ErrorEvent } from '@sentry/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const envState: { value: Record<string, string | undefined> } = { value: {} };
vi.mock('./env.js', () => ({
  get env() {
    return envState.value;
  },
}));

const { buildSentryOptions, initErrorReporting, reportError, scrubEvent } = await import(
  './error-reporting.js'
);

// ---------------------------------------------------------------------------
// Fixtures PII Booster (ADR-074 — datos protegidos explícitos)
// ---------------------------------------------------------------------------
const PII = {
  rut: '12.345.678-5',
  imei: '860693088550059',
  coordenadas: '-33.4489,-70.6693',
  montoClp: '$1.234.567',
  montoUf: 'UF 2.500',
  email: 'cliente@empresa.cl',
  telefono: '+56 9 1234 5678',
  patente: 'VFZH-68',
  credencial: 'token=fake-test-credencial-fixture',
};

/** Evento sintético cargado con TODO lo prohibido, en cada superficie. */
function eventoCargado(): ErrorEvent {
  return {
    type: undefined,
    event_id: 'e1',
    timestamp: 1721088000,
    level: 'error',
    release: 'abc123',
    environment: 'production',
    platform: 'javascript',
    message: `mensaje prohibido con ${PII.rut}`,
    logger: 'no-permitido',
    transaction: `/app/flota?rut=${PII.rut}`,
    user: { id: 'u1', email: PII.email, username: `RUT ${PII.rut}`, ip_address: '10.0.0.9' },
    breadcrumbs: [{ message: `click con ${PII.rut}`, data: { imei: PII.imei } }],
    request: {
      url: `https://app.boosterchile.com/app/flota?${PII.credencial}&patente=${PII.patente}#frag`,
      headers: { Authorization: 'Bearer super-secreto' },
      cookies: { session: 'abc' },
      data: `{"rut":"${PII.rut}","monto":"${PII.montoClp}"}`,
      query_string: PII.credencial,
    },
    contexts: {
      browser: { name: 'Chrome', version: '126', user_agent: 'UA COMPLETO' },
      os: { name: 'macOS', version: '15', build: 'no-permitido' },
      app: { app_memory: 123 },
    },
    tags: { foo: 'no-permitido' },
    extra: { payload: { monto: PII.montoClp, tel: PII.telefono } },
    exception: {
      values: [
        {
          type: 'TypeError',
          value:
            `RUT ${PII.rut} no encontrado; patente ${PII.patente}; coords ${PII.coordenadas}; ` +
            `IMEI ${PII.imei}; pago ${PII.montoClp} / ${PII.montoUf}; mail ${PII.email}; ` +
            `tel ${PII.telefono}; ${PII.credencial}`,
          module: 'no-permitido',
          stacktrace: {
            frames: [
              {
                filename: 'app/assets/index-abc.js',
                function: 'RoutePolyline',
                lineno: 148,
                colno: 34,
                vars: { rut: PII.rut },
                context_line: `const rut = "${PII.rut}"`,
                pre_context: [`email ${PII.email}`],
                post_context: [],
              },
            ],
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  envState.value = {};
});

// ---------------------------------------------------------------------------
// scrubEvent — el contrato verificable de ADR-074
// ---------------------------------------------------------------------------
describe('scrubEvent (contrato ADR-074)', () => {
  it('golden allowlist: de un evento cargado sobreviven SOLO los campos permitidos', () => {
    const out = scrubEvent(eventoCargado());

    expect(Object.keys(out).sort()).toEqual(
      [
        'contexts',
        'environment',
        'event_id',
        'exception',
        'level',
        'platform',
        'release',
        'request',
        'tags',
        'timestamp',
        'type',
      ].sort(),
    );
    // Ruta: pathname puro, sin query ni hash ni origin.
    expect(out.request).toEqual({ url: '/app/flota' });
    // Contexts: browser/os con name+version, nada más.
    expect(Object.keys(out.contexts ?? {}).sort()).toEqual(['browser', 'os']);
    expect(out.contexts?.browser).toEqual({ name: 'Chrome', version: '126' });
    expect(out.contexts?.os).toEqual({ name: 'macOS', version: '15' });
    // Frames: exactamente filename/function/lineno/colno — sin vars ni context.
    const frame = out.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame).toEqual({
      filename: 'app/assets/index-abc.js',
      function: 'RoutePolyline',
      lineno: 148,
      colno: 34,
    });
    // Lo prohibido no existe como campo.
    expect('message' in out).toBe(false);
    expect('user' in out).toBe(false);
    expect('breadcrumbs' in out).toBe(false);
    expect('extra' in out).toBe(false);
  });

  it('SUPERVIVENCIA: ninguna PII Booster sobrevive en el JSON serializado post-scrub', () => {
    const json = JSON.stringify(scrubEvent(eventoCargado()));
    for (const [tipo, valor] of Object.entries(PII)) {
      expect(json.includes(valor), `PII "${tipo}" (${valor}) sobrevivió al scrub`).toBe(false);
    }
    expect(json.includes('Authorization')).toBe(false);
    expect(json.includes('super-secreto')).toBe(false);
    expect(json.includes('fake-test-credencial-fixture')).toBe(false);
  });

  it('message: doble barrera — scrub por patrón + truncado a 300 + tag scrubbed', () => {
    const evento = eventoCargado();
    const values = evento.exception?.values;
    if (values?.[0]) {
      values[0].value = `${'x'.repeat(400)} RUT ${PII.rut}`;
    }
    const out = scrubEvent(evento);
    const value = out.exception?.values?.[0]?.value ?? '';
    expect(value.length).toBeLessThanOrEqual(300);
    expect(out.tags).toEqual({ scrubbed: 'true' });

    const conRut = eventoCargado();
    const scrubbedValue = scrubEvent(conRut).exception?.values?.[0]?.value ?? '';
    expect(scrubbedValue).toContain('[REDACTED-rut]');
    expect(scrubbedValue).not.toContain(PII.rut);
  });

  it('es pura: no muta el evento de entrada', () => {
    const evento = eventoCargado();
    const snapshot = JSON.stringify(evento);
    scrubEvent(evento);
    expect(JSON.stringify(evento)).toBe(snapshot);
  });

  it('sin PII no marca scrubbed (sin tags)', () => {
    const limpio: ErrorEvent = {
      type: undefined,
      exception: { values: [{ type: 'TypeError', value: 'x is not a constructor' }] },
    };
    const out = scrubEvent(limpio);
    expect(out.tags).toBeUndefined();
    expect(out.exception?.values?.[0]?.value).toBe('x is not a constructor');
  });
});

// ---------------------------------------------------------------------------
// init: no-op silencioso sin DSN
// ---------------------------------------------------------------------------
describe('initErrorReporting sin DSN', () => {
  it('no inicializa cliente ni lanza; reportError es no-op seguro', () => {
    envState.value = {}; // sin VITE_SENTRY_DSN
    expect(() => initErrorReporting()).not.toThrow();
    expect(Sentry.getClient()).toBeUndefined();
    expect(() => reportError(new Error('sin sink'))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ACEPTACIÓN del frente — crash clase LatLngBounds bajo el router,
// pipeline REAL del SDK (transport fake), sin-wiring vs con-wiring.
// ---------------------------------------------------------------------------
describe('aceptación: crash tipo LatLngBounds bajo el router', () => {
  const envelopes: string[] = [];

  function extraerEventos(): ErrorEvent[] {
    const eventos: ErrorEvent[] = [];
    for (const body of envelopes) {
      for (const line of body.split('\n')) {
        try {
          const parsed: unknown = JSON.parse(line);
          if (parsed !== null && typeof parsed === 'object' && 'exception' in parsed) {
            eventos.push(parsed as ErrorEvent);
          }
        } catch {
          // línea de envelope no-JSON (headers binarios) — irrelevante
        }
      }
    }
    return eventos;
  }

  async function montarConCrash(withWiring: boolean): Promise<void> {
    const {
      ErrorComponent,
      RouterProvider,
      createMemoryHistory,
      createRootRoute,
      createRoute,
      createRouter,
    } = await import('@tanstack/react-router');
    const { useEffect } = await import('react');
    const { createElement } = await import('react');
    const { render } = await import('@testing-library/react');

    function Boom(): null {
      useEffect(() => {
        // La forma exacta del bug de #600/#601: constructor pedido a un
        // objeto que no lo tiene.
        const lib = {} as { LatLngBounds: new () => unknown };
        new lib.LatLngBounds();
      }, []);
      return null;
    }

    const rootRoute = createRootRoute();
    const boomRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/boom',
      component: Boom,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([boomRoute]),
      history: createMemoryHistory({ initialEntries: ['/boom'] }),
      // El boundary SOLO envuelve si hay errorComponent resuelto (Match.js);
      // presente en AMBOS casos para que el delta sea el onCatch puro.
      defaultErrorComponent: ErrorComponent,
      ...(withWiring ? { defaultOnCatch: (error: Error) => reportError(error) } : {}),
    });
    await router.load();
    render(createElement(RouterProvider, { router: router as never }));
    // Tick para que el match monte y el effect (donde revienta) corra.
    await new Promise((r) => setTimeout(r, 25));
    await Sentry.flush(2000);
  }

  beforeEach(() => {
    envelopes.length = 0;
    // Silenciar el ruido de React/CatchBoundary al capturar el error.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    if (!Sentry.getClient()) {
      Sentry.init({
        ...buildSentryOptions('https://pub@o0.ingest.sentry.io/0'),
        transport: (options) =>
          createTransport(options, (request) => {
            envelopes.push(String(request.body));
            return Promise.resolve({});
          }),
      });
    }
    // Sanidad: si el init falló (warn mockeado lo ocultaría), que reviente acá.
    expect(Sentry.getClient()).toBeDefined();
  });

  afterAll(async () => {
    await Sentry.getClient()?.close(0);
  });

  it('SIN wiring: el CatchBoundary default se traga el crash y NADA llega al sink', async () => {
    await montarConCrash(false);
    expect(extraerEventos()).toHaveLength(0);
  });

  it('CON wiring (defaultOnCatch → reportError): llega TypeError legible y scrubbeado', async () => {
    await montarConCrash(true);
    const eventos = extraerEventos();
    expect(eventos.length).toBeGreaterThanOrEqual(1);
    const evento = eventos[0];
    // (a) stack/type legible
    expect(evento?.exception?.values?.[0]?.type).toBe('TypeError');
    expect(evento?.exception?.values?.[0]?.value).toContain('LatLngBounds');
    const frames = evento?.exception?.values?.[0]?.stacktrace?.frames ?? [];
    expect(frames.length).toBeGreaterThan(0);
    // (b) pasó por scrubEvent: forma allowlist — sin breadcrumbs/user/extra,
    // y los frames proyectados a los 4 campos permitidos.
    expect(evento && 'breadcrumbs' in evento).toBe(false);
    expect(evento && 'user' in evento).toBe(false);
    expect(evento && 'extra' in evento).toBe(false);
    for (const f of frames) {
      const keys = Object.keys(f as Record<string, unknown>);
      for (const k of keys) {
        expect(['filename', 'function', 'lineno', 'colno']).toContain(k);
      }
    }
  });
});
