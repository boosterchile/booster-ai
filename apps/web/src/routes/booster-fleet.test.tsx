import type { PanelBoosterFleet } from '@booster-ai/shared-schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Ctx = { kind: 'onboarded'; me: MeOnboarded } | { kind: 'unmanaged' };
let providedContext: Ctx = { kind: 'unmanaged' };

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: Ctx) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => {
    const ruta = Object.entries(params ?? {}).reduce(
      (acumulado, [clave, valor]) => acumulado.replace(`$${clave}`, valor),
      to,
    );
    const consulta = new URLSearchParams(search ?? {}).toString();
    return (
      <a href={consulta ? `${ruta}?${consulta}` : ruta} {...props}>
        {children}
      </a>
    );
  },
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { BoosterFleetRoute } = await import('./booster-fleet.js');

const VEHICULO = '11111111-1111-4111-8111-111111111111';
const CONDUCTOR = '55555555-5555-4555-8555-555555555555';
const MANTENCION = '33333333-3333-4333-8333-333333333333';

function me(rol: 'dueno' | 'admin' | 'despachador' = 'dueno', transportista = true): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'Dueño' } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role: rol,
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e',
        legal_name: 'Transportes Demo',
        rut: '76.123.456-7',
        is_generador_carga: false,
        is_transportista: transportista,
        status: 'activa',
      },
    },
  } as MeOnboarded;
}

function panel(): PanelBoosterFleet {
  return {
    configuracion: {
      slug: 'booster-fleet',
      nombre: 'Booster Fleet',
      servicio: 'gestion_de_flota',
      audiencia: 'dueno_transportista',
      ventana_combustible_dias: 7,
    },
    combustible: {
      desde: '2026-11-10T15:00:00.000Z',
      hasta: '2026-11-17T15:00:00.000Z',
      truncado: true,
      litros: 30,
      km: 100,
      litros_por_100_km: 30,
      con_alerta: 1,
      vehiculos: [
        {
          vehiculo_id: VEHICULO,
          patente: 'AAAA11',
          senal: 'posible_robo',
          litros: 30,
          km: 100,
          litros_por_100_km: 30,
          alertas: ['golpe'],
        },
      ],
    },
    documental: {
      vehiculos_al_dia: 0,
      vehiculos_con_hallazgo: 1,
      conductores_al_dia: 0,
      conductores_con_hallazgo: 1,
      vehiculos: [
        {
          vehiculo_id: VEHICULO,
          patente: 'AAAA11',
          al_dia: false,
          estado: 'faltante',
          documentos: [
            {
              tipo: 'revision_tecnica',
              estado: 'faltante',
              fecha_vencimiento: null,
              archivo: false,
            },
            {
              tipo: 'permiso_circulacion',
              estado: 'vigente',
              fecha_vencimiento: '2027-01-01',
              archivo: true,
            },
            { tipo: 'soap', estado: 'vigente', fecha_vencimiento: '2027-01-01', archivo: true },
          ],
        },
      ],
      conductores: [
        {
          conductor_id: CONDUCTOR,
          nombre: 'Ana Soto',
          rut: '',
          al_dia: false,
          estado: 'sin_archivo',
          documentos: [
            {
              tipo: 'licencia_conducir',
              estado: 'sin_archivo',
              fecha_vencimiento: '2027-01-01',
              archivo: false,
            },
          ],
        },
      ],
    },
    mantenciones: {
      vencidas: 1,
      proximas: 0,
      programadas: 0,
      truncadas: true,
      en_taller: [{ vehiculo_id: VEHICULO, patente: 'AAAA11' }],
      items: [
        {
          id: MANTENCION,
          vehiculo_id: VEHICULO,
          patente: 'AAAA11',
          tipo: 'preventiva',
          titulo: 'Cambio de aceite',
          programada_para: '2026-11-01',
          kilometraje_objetivo: null,
          estado: 'vencida',
          realizada_en: null,
          notas: 'taller sur',
        },
      ],
    },
  };
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const OTRO = '22222222-2222-4222-8222-222222222222';
const TERCERO = '44444444-4444-4444-8444-444444444444';
const CUARTO = '66666666-6666-4666-8666-666666666666';

type Vehiculo = PanelBoosterFleet['combustible']['vehiculos'][number];

function vehiculo(id: string, patente: string, extra: Partial<Vehiculo> = {}): Vehiculo {
  return {
    vehiculo_id: id,
    patente,
    senal: 'en_orden',
    litros: 300,
    km: 1000,
    litros_por_100_km: 30,
    alertas: [],
    ...extra,
  };
}

function conDesviacion(): PanelBoosterFleet {
  const base = panel();
  const primero = base.combustible.vehiculos[0];
  if (primero) {
    primero.desviacion = {
      trayecto_id: 'trayecto-1',
      inicio: '2026-11-12T21:00:00.000Z',
      fin: '2026-11-13T10:00:00.000Z',
      tipo: 'golpe',
      desde: '2026-11-13T06:12:00.000Z',
      hasta: '2026-11-13T06:16:00.000Z',
      litros: 62,
      lat: -34.98,
      lon: -71.23,
      total: 1,
    };
  }
  return base;
}

function entrar(datos: PanelBoosterFleet) {
  vi.spyOn(api, 'get').mockResolvedValue(datos);
  providedContext = { kind: 'onboarded', me: me() };
  return wrap(<BoosterFleetRoute />);
}

describe('BoosterFleetRoute', () => {
  it('sin sesión no muestra el panel', () => {
    wrap(<BoosterFleetRoute />);
    expect(screen.queryByText('Booster Fleet')).not.toBeInTheDocument();
  });

  it('pide el panel aceptando la lectura guardada y dice a qué hora se leyó', async () => {
    const datos = panel();
    datos.combustible.leido_en = new Date().toISOString();
    datos.combustible.al_dia = true;
    entrar(datos);
    expect(await screen.findByText(/Combustible leído a las \d\d:\d\d/)).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.map((c) => c[0])).toEqual([
      '/booster-fleet?combustible=guardada',
    ]);
    expect(screen.queryByText(/actualizando/)).not.toBeInTheDocument();
  });

  it('con una lectura que no está al día la muestra, pide la nueva y la reemplaza', async () => {
    const guardada = panel();
    guardada.combustible.leido_en = new Date(Date.now() - 3 * 3_600_000).toISOString();
    guardada.combustible.al_dia = false;
    guardada.combustible.litros_por_100_km = 77.7;
    const nueva = panel();
    nueva.combustible.leido_en = new Date().toISOString();
    nueva.combustible.al_dia = true;
    nueva.combustible.litros_por_100_km = 66.6;
    let soltar: (valor: PanelBoosterFleet) => void = () => undefined;
    const get = vi.spyOn(api, 'get').mockImplementation((url: string) =>
      url.includes('combustible=guardada')
        ? Promise.resolve(guardada)
        : new Promise((resolve) => {
            soltar = resolve as (valor: PanelBoosterFleet) => void;
          }),
    );
    providedContext = { kind: 'onboarded', me: me() };
    wrap(<BoosterFleetRoute />);

    // Las cifras guardadas quedan a la vista mientras llega la lectura nueva.
    expect(await screen.findByText(/actualizando…/)).toBeInTheDocument();
    expect(screen.getByText('77,7')).toBeInTheDocument();
    await waitFor(() =>
      expect(get.mock.calls.map((c) => c[0])).toEqual([
        '/booster-fleet?combustible=guardada',
        '/booster-fleet',
      ]),
    );

    soltar(nueva);
    expect(await screen.findByText('66,6')).toBeInTheDocument();
    expect(screen.queryByText(/actualizando…/)).not.toBeInTheDocument();
    expect(screen.queryByText('77,7')).not.toBeInTheDocument();
  });

  // El reloj va fijo: con el reloj real, una lectura de «hace 20 minutos» cae
  // en el día anterior entre las 00:00 y las 00:20 de Santiago y el texto cambia.
  const lecturaGuardadaQueNoSeActualiza = (ahora: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(ahora));
    const guardada = panel();
    guardada.combustible.leido_en = new Date(Date.now() - 20 * 60_000).toISOString();
    guardada.combustible.al_dia = false;
    guardada.combustible.litros_por_100_km = 77.7;
    vi.spyOn(api, 'get').mockImplementation((url: string) =>
      url.includes('combustible=guardada')
        ? Promise.resolve(guardada)
        : Promise.reject(new Error('sin red')),
    );
    providedContext = { kind: 'onboarded', me: me() };
    wrap(<BoosterFleetRoute />);
  };

  it('si la lectura nueva falla conserva las cifras y dice de qué hora son', async () => {
    // 12:00 en Santiago: la lectura guardada es de las 11:40 del mismo día.
    lecturaGuardadaQueNoSeActualiza('2026-11-18T15:00:00Z');

    expect(
      await screen.findByText('No se pudo actualizar. Estas cifras son de las 11:40.'),
    ).toBeInTheDocument();
    expect(screen.getByText('77,7')).toBeInTheDocument();
    expect(screen.queryByText(/actualizando…/)).not.toBeInTheDocument();
  });

  it('si la lectura que conserva es del día anterior, dice también la fecha', async () => {
    // 00:06 en Santiago: la lectura guardada es de las 23:46 del día anterior.
    lecturaGuardadaQueNoSeActualiza('2026-11-24T03:06:00Z');

    expect(
      await screen.findByText('No se pudo actualizar. Estas cifras son del lun 23 nov, 23:46.'),
    ).toBeInTheDocument();
    expect(screen.getByText('77,7')).toBeInTheDocument();
  });

  it('un despachador ve que el control es del dueño', () => {
    const get = vi.spyOn(api, 'get');
    providedContext = { kind: 'onboarded', me: me('despachador') };
    wrap(<BoosterFleetRoute />);
    expect(screen.getByText(/control de flota del dueño/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('la primera oración nombra la patente y la desviación, con su hora, litros y lugar', async () => {
    const { container } = entrar(conDesviacion());
    expect(
      await screen.findByText('1 camión pide revisión.', { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Parte por AAAA11: una desviación de combustible por analizar.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Desviación')).toBeInTheDocument();
    const descripcion = screen.getByText(/−62,0 L/);
    expect(descripcion).toHaveTextContent('vie 13 nov, 03:16');
    expect(descripcion).toHaveTextContent('-34.9800, -71.2300');
    expect(screen.getByRole('link', { name: 'Analizar trayecto' })).toHaveAttribute(
      'href',
      `/app/trayectos?vehiculo=${VEHICULO}&detalle=trayecto-1`,
    );
    expect(screen.getByText(/ventana de telemetría vino cortada/)).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/robo/i);
  });

  it('con recorte, el aviso dice desde cuándo son las cifras', async () => {
    const datos = panel();
    datos.combustible.truncado = true;
    datos.combustible.cobertura_desde = '2026-11-14T15:30:00.000Z';
    entrar(datos);
    const aviso = await screen.findByText(/Las cifras de combustible son desde el/);
    expect(aviso).toHaveTextContent('sáb 14 nov, 12:30');
    expect(aviso).toHaveTextContent('no los 7 días completos');
    expect(screen.queryByText(/ventana de telemetría vino cortada/)).not.toBeInTheDocument();
  });

  it('con recorte y sin la fecha, mantiene el aviso general', async () => {
    const datos = panel();
    datos.combustible.truncado = true;
    entrar(datos);
    expect(await screen.findByText(/ventana de telemetría vino cortada/)).toBeInTheDocument();
  });

  it('con la ventana completa no hay aviso', async () => {
    const datos = panel();
    datos.combustible.truncado = false;
    entrar(datos);
    await screen.findByText('Desviación');
    expect(screen.queryByText(/Las cifras de combustible son desde el/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ventana de telemetría vino cortada/)).not.toBeInTheDocument();
  });

  it('una desviación sin datos del evento lo dice en palabras', async () => {
    entrar(panel());
    expect(await screen.findByText('Desviación de combustible por analizar')).toBeInTheDocument();
  });

  it('con la flota en orden la frase lo dice y no hay filas de alerta', async () => {
    const datos = panel();
    datos.combustible.con_alerta = 0;
    datos.combustible.vehiculos = [vehiculo(VEHICULO, 'AAAA11')];
    entrar(datos);
    expect(await screen.findByText('Tu camión está en orden esta semana.')).toBeInTheDocument();
    expect(screen.queryByText(/Analizar primero/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Analizar trayecto' })).not.toBeInTheDocument();
  });

  it('agrupa por tono en orden de gravedad y colapsa los camiones en orden', async () => {
    const datos = panel();
    datos.combustible.con_alerta = 3;
    datos.combustible.vehiculos = [
      vehiculo(VEHICULO, 'AAAA11', { senal: 'posible_robo', alertas: ['golpe'] }),
      vehiculo(OTRO, 'BBBB22', { senal: 'sin_sensor', litros: null, litros_por_100_km: null }),
      vehiculo(TERCERO, 'CCCC33', { senal: 'consumo_alto', litros_por_100_km: 41.2 }),
      vehiculo(CUARTO, 'DDDD44'),
      vehiculo(CONDUCTOR, 'EEEE55', { litros_por_100_km: 32 }),
    ];
    const { container } = entrar(datos);
    await screen.findByText('3 camiones piden revisión.', { exact: false });
    const grupos = Array.from(container.querySelectorAll('tbody > tr:first-child > th')).map(
      (th) => th.textContent,
    );
    expect(grupos).toEqual([
      'Analizar primero · 1',
      'Sin lectura · 1',
      'Atención · 1',
      'En orden · 2',
    ]);
    expect(screen.getByText(/puede ser la vía/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revisar sensor' })).toHaveAttribute(
      'href',
      `/app/vehiculos/${OTRO}`,
    );
    expect(screen.getByRole('link', { name: 'Comparar trayectos' })).toBeInTheDocument();
    const enOrden = container.querySelectorAll('tbody:last-of-type > tr');
    expect(enOrden).toHaveLength(2);
    expect(
      screen.getByRole('img', { name: /5 camiones: 1 desviación, 1 sin lectura/ }),
    ).toBeInTheDocument();
  });

  it('lista los documentos pendientes sin el RUT y con enlace a la ficha', async () => {
    entrar(panel());
    expect(await screen.findByText('Revisión técnica')).toBeInTheDocument();
    expect(screen.getByText(/Falta el documento/)).toBeInTheDocument();
    expect(screen.getByText('Ana Soto')).toBeInTheDocument();
    expect(screen.getByText(/Falta el archivo/)).toBeInTheDocument();
    expect(screen.queryByText(/Sin RUT/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir ficha de Ana Soto' })).toHaveAttribute(
      'href',
      `/app/conductores/${CONDUCTOR}`,
    );
    expect(
      screen.getByRole('link', { name: 'Abrir ficha de la patente AAAA11' }),
    ).toBeInTheDocument();
    expect(screen.getByText('En taller')).toBeInTheDocument();
    expect(screen.getByText(/más mantenciones/)).toBeInTheDocument();
  });

  it('con más de seis documentos pendientes despliega el resto en el mismo lugar', async () => {
    const datos = panel();
    const tipos = [
      'revision_tecnica',
      'permiso_circulacion',
      'soap',
      'padron',
      'seguro_carga',
      'certificado_emisiones',
      'poliza_responsabilidad',
    ];
    const fila = datos.documental.vehiculos[0];
    if (fila) {
      fila.documentos = tipos.map((tipo) => ({
        tipo,
        estado: 'por_vencer' as const,
        fecha_vencimiento: '2026-12-01',
        archivo: true,
      }));
    }
    datos.documental.conductores = [];
    const user = userEvent.setup();
    entrar(datos);
    const boton = await screen.findByRole('button', { name: 'Ver los 7 pendientes' });
    expect(screen.queryByText('Póliza de responsabilidad civil')).not.toBeInTheDocument();
    await user.click(boton);
    expect(screen.getByText('Póliza de responsabilidad civil')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver menos' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('una respuesta mal formada se muestra como error', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ no: 'es' });
    providedContext = { kind: 'onboarded', me: me('admin') };
    wrap(<BoosterFleetRoute />);
    expect(await screen.findByText(/no tiene la forma esperada/)).toBeInTheDocument();
  });

  it('un error del API se muestra', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'error', {}, 'falló el panel'));
    providedContext = { kind: 'onboarded', me: me() };
    wrap(<BoosterFleetRoute />);
    expect(await screen.findByText('falló el panel')).toBeInTheDocument();
  });

  it('programa una mantención desde el modal y marca una como realizada', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ mantencion: {} });
    const user = userEvent.setup();
    entrar(panel());
    await user.click(await screen.findByRole('button', { name: 'Programar mantención' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Programar mantención' });
    expect(dialogo).toBeInTheDocument();
    await user.type(screen.getByLabelText('Qué hay que hacer'), 'Cambio de filtro');
    await user.type(screen.getByLabelText('Kilometraje objetivo (opcional)'), '120000');
    await user.click(screen.getByRole('button', { name: 'Guardar mantención' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe('/booster-fleet/mantenciones');
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      vehiculo_id: VEHICULO,
      tipo: 'preventiva',
      titulo: 'Cambio de filtro',
      kilometraje_objetivo: 120000,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(
      screen.getByRole('button', { name: 'Marcar realizada: Cambio de aceite, AAAA11' }),
    );
    await waitFor(() =>
      expect(post.mock.calls.some((call) => String(call[0]).endsWith('/realizar'))).toBe(true),
    );
    expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(1);
  });

  it('cancelar confirma en un modal, sin window.confirm, y muestra el error del API', async () => {
    const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('no se pudo'));
    const confirmar = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    entrar(panel());
    await user.click(
      await screen.findByRole('button', { name: 'Cancelar: Cambio de aceite, AAAA11' }),
    );
    expect(
      await screen.findByRole('dialog', { name: '¿Cancelar la mantención?' }),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sí, cancelar' }));
    await waitFor(() =>
      expect(post.mock.calls.some((call) => String(call[0]).endsWith('/cancelar'))).toBe(true),
    );
    expect(await screen.findByText('no se pudo')).toBeInTheDocument();
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('volver en la confirmación no cancela nada', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({});
    const user = userEvent.setup();
    entrar(panel());
    await user.click(
      await screen.findByRole('button', { name: 'Cancelar: Cambio de aceite, AAAA11' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Volver' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
  });

  it('sin mantenciones muestra el estado vacío con el formulario a la vista', async () => {
    const datos = panel();
    datos.mantenciones = {
      vencidas: 0,
      proximas: 0,
      programadas: 0,
      truncadas: false,
      en_taller: [],
      items: [],
    };
    const post = vi.spyOn(api, 'post').mockResolvedValue({ mantencion: {} });
    const user = userEvent.setup();
    entrar(datos);
    expect(await screen.findByText('Taller en silencio.')).toBeInTheDocument();
    expect(screen.getByText('Ninguna abierta')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Qué hay que hacer'), 'Cambio de aceite');
    await user.click(screen.getByRole('button', { name: 'Guardar mantención' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe('/booster-fleet/mantenciones');
  });

  it('si programar falla, muestra el mensaje', async () => {
    const datos = panel();
    datos.mantenciones.items = [];
    vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('no se guardó'));
    const user = userEvent.setup();
    entrar(datos);
    await user.type(await screen.findByLabelText('Qué hay que hacer'), 'Cambio de aceite');
    await user.click(screen.getByRole('button', { name: 'Guardar mantención' }));
    expect(await screen.findByText('no se guardó')).toBeInTheDocument();
  });

  it('una flota vacía lo dice y no deja programar', async () => {
    const vacio = panel();
    vacio.combustible.vehiculos = [];
    vacio.combustible.con_alerta = 0;
    vacio.combustible.litros_por_100_km = null;
    vacio.combustible.truncado = false;
    vacio.documental.vehiculos = [];
    vacio.documental.conductores = [];
    vacio.mantenciones.items = [];
    vacio.mantenciones.truncadas = false;
    vacio.mantenciones.en_taller = [];
    entrar(vacio);
    expect(
      (await screen.findAllByText('Todavía no hay vehículos en la flota.')).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Sin documentos pendientes.')).toBeInTheDocument();
    expect(screen.getByText('Sin lectura confiable todavía')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Programar mantención' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardar mantención' })).toBeDisabled();
  });

  it('el panel no tiene violaciones de accesibilidad', async () => {
    const { container } = entrar(conDesviacion());
    await screen.findByText('Desviación');
    const resultado = await axe(container);
    expect(resultado.violations).toEqual([]);
  });
});
