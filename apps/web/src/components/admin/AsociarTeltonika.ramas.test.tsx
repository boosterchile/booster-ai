import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { AsociarTeltonika } from './AsociarTeltonika.js';

/**
 * Ramas de AsociarTeltonika que `AsociarTeltonika.test.tsx` no cubre:
 * errores de carga, IMEI inválido, códigos de error del API y validaciones
 * del alta.
 */

const IMEI = '356307042441013';
const EMPRESAS = [
  { id: 'emp-1', razon_social: 'Transportes Sur SpA', rut: '76111222-8', es_transportista: true },
  { id: 'emp-2', razon_social: 'Generadora Norte SpA', rut: '76333444-5', es_transportista: false },
];

type Respuestas = {
  empresas?: unknown;
  vehiculos?: unknown;
  devices?: unknown;
};

/** Cada entrada es la respuesta del GET, o un Error para que falle. */
function mockGets(r: Respuestas) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    const pick = path.startsWith('/admin/plataforma/dispositivos/vehiculos')
      ? (r.vehiculos ?? { vehiculos: [] })
      : path === '/admin/plataforma/dispositivos'
        ? (r.devices ?? { devices: [] })
        : (r.empresas ?? { empresas: EMPRESAS });
    if (pick instanceof Error) {
      throw pick;
    }
    return pick;
  });
}

async function llenarAlta(campos: Partial<Record<string, string>> = {}) {
  await screen.findByRole('option', { name: /Transportes Sur SpA/ });
  const valores = { empresa: 'emp-1', patente: 'abcd12', capacidad: '3500', imei: IMEI, ...campos };
  for (const [campo, value] of Object.entries(valores)) {
    fireEvent.change(screen.getByTestId(`teltonika-${campo}`), { target: { value } });
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('AsociarTeltonika — carga', () => {
  it('solo ofrece empresas de transportes', async () => {
    mockGets({});
    render(<AsociarTeltonika />);

    await screen.findByRole('option', { name: /Transportes Sur SpA/ });
    expect(screen.queryByRole('option', { name: /Generadora Norte/ })).toBeNull();
  });

  it('muestra el error del API si fallan las empresas', async () => {
    mockGets({ empresas: new ApiError(403, 'forbidden', null, 'sin permiso') });
    render(<AsociarTeltonika />);

    expect(await screen.findByRole('alert')).toHaveTextContent('403: sin permiso');
  });

  it('muestra errores que no son del API tal cual', async () => {
    mockGets({ devices: new Error('red caída') });
    render(<AsociarTeltonika />);

    expect(await screen.findByRole('alert')).toHaveTextContent('red caída');
  });

  it('error al cargar los camiones de la empresa', async () => {
    mockGets({ vehiculos: new ApiError(500, undefined, null, 'boom') });
    render(<AsociarTeltonika />);

    fireEvent.click(await screen.findByTestId('teltonika-modo-existente'));
    await screen.findByRole('option', { name: /Transportes Sur SpA/ });
    fireEvent.change(screen.getByTestId('teltonika-empresa'), { target: { value: 'emp-1' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('500: boom');
  });

  it('marca el camión que ya tiene IMEI y el pendiente sin modelo ni fecha', async () => {
    mockGets({
      vehiculos: { vehiculos: [{ id: 'veh-1', patente: 'ABCD12', teltonika_imei: IMEI }] },
      devices: {
        devices: [
          {
            id: 'd-1',
            imei: '111111111111111',
            ultima_conexion_en: null,
            modelo_detectado: null,
            cantidad_conexiones: 1,
          },
        ],
      },
    });
    render(<AsociarTeltonika />);

    expect(await screen.findByTestId('teltonika-pendientes')).toHaveTextContent(
      'modelo sin detectar',
    );
    fireEvent.click(screen.getByTestId('teltonika-modo-existente'));
    await screen.findByRole('option', { name: /Transportes Sur SpA/ });
    fireEvent.change(screen.getByTestId('teltonika-empresa'), { target: { value: 'emp-1' } });
    expect(await screen.findByRole('option', { name: `ABCD12 · IMEI ${IMEI}` })).toBeTruthy();
  });
});

describe('AsociarTeltonika — IMEI', () => {
  it('con un IMEI de menos de 15 dígitos no deja habilitar', async () => {
    mockGets({});
    render(<AsociarTeltonika />);
    await llenarAlta({ imei: '35630704244' });

    expect(screen.getByTestId('teltonika-habilitar')).toBeDisabled();
  });

  it('con un IMEI con letras no deja asignar', async () => {
    mockGets({
      vehiculos: { vehiculos: [{ id: 'veh-1', patente: 'ABCD12', teltonika_imei: null }] },
    });
    render(<AsociarTeltonika />);
    fireEvent.click(await screen.findByTestId('teltonika-modo-existente'));
    await screen.findByRole('option', { name: /Transportes Sur SpA/ });
    fireEvent.change(screen.getByTestId('teltonika-empresa'), { target: { value: 'emp-1' } });
    await screen.findByRole('option', { name: /ABCD12/ });
    fireEvent.change(screen.getByTestId('teltonika-vehiculo'), { target: { value: 'veh-1' } });
    fireEvent.change(screen.getByTestId('teltonika-imei'), {
      target: { value: '35630704244101X' },
    });

    expect(screen.getByTestId('teltonika-asociar')).toBeDisabled();
  });
});

describe('AsociarTeltonika — errores del API al habilitar', () => {
  it.each([
    ['imei_en_uso', 'Ese IMEI ya está asignado a otro camión.'],
    ['imei_rechazado', 'Ese IMEI fue rechazado antes. No se reasigna desde aquí.'],
    ['imei_espejo_activo', 'Ese camión mira el GPS de otro equipo.'],
    ['plate_duplicate', 'Ya existe un vehículo con esa patente.'],
    ['empresa_no_transportista', 'Esa empresa no es de transportes.'],
    ['arrastre_curb_weight_requerido', 'Un semi-remolque necesita el peso vacío.'],
    ['otro_codigo', '409: conflicto'],
  ])('%s → mensaje para el admin', async (code, mensaje) => {
    mockGets({});
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, code, null, 'conflicto'));
    render(<AsociarTeltonika />);
    await llenarAlta();
    fireEvent.click(screen.getByTestId('teltonika-habilitar'));

    expect(await screen.findByRole('alert')).toHaveTextContent(mensaje);
  });

  it('error al rechazar un pendiente deja el equipo en la bandeja', async () => {
    mockGets({
      devices: {
        devices: [
          {
            id: 'd-1',
            imei: IMEI,
            ultima_conexion_en: null,
            modelo_detectado: 'FMC150',
            cantidad_conexiones: 2,
          },
        ],
      },
    });
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(404, 'not_found', null, 'no existe'));
    render(<AsociarTeltonika />);
    fireEvent.click(await screen.findByTestId(`teltonika-rechazar-${IMEI}`));

    expect(await screen.findByRole('alert')).toHaveTextContent('404: no existe');
    expect(screen.getByTestId(`teltonika-rechazar-${IMEI}`)).toBeEnabled();
  });
});

describe('AsociarTeltonika — validaciones del alta', () => {
  it.each([
    [{ patente: 'XX' }, /patente/i],
    [{ capacidad: '0' }, 'Ingresa la capacidad de carga en kilos, entre 1 y 100.000.'],
    [{ tipo: 'semi_remolque' }, 'Un semi-remolque necesita el peso vacío.'],
    [{ peso: '60000' }, 'El peso vacío tiene que ser un entero entre 1 y 50.000 kg.'],
    [{ anio: '1970' }, 'El año tiene que estar entre 1980 y 2100.'],
  ])('%o → no llama al API', async (campos, mensaje) => {
    mockGets({});
    const post = vi.spyOn(api, 'post');
    render(<AsociarTeltonika />);
    await llenarAlta(campos);
    fireEvent.click(screen.getByTestId('teltonika-habilitar'));

    expect(await screen.findByRole('alert')).toHaveTextContent(mensaje);
    expect(post).not.toHaveBeenCalled();
  });

  it('envía modelo, año, combustible y peso, y avisa si ya estaba en la empresa', async () => {
    mockGets({});
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      patente: 'ABCD12',
      razon_social: 'Transportes Sur SpA',
      teltonika_imei: IMEI,
      ya_existia: true,
    });
    render(<AsociarTeltonika />);
    await llenarAlta({ modelo: 'FH', anio: '2020', combustible: 'diesel', peso: '8000' });
    fireEvent.click(screen.getByTestId('teltonika-habilitar'));

    expect(await screen.findByTestId('teltonika-ok')).toHaveTextContent(
      'El camión ABCD12 ya estaba en Transportes Sur SpA.',
    );
    expect(post).toHaveBeenCalledWith(
      '/admin/plataforma/dispositivos/habilitar',
      expect.objectContaining({
        model: 'FH',
        year: 2020,
        fuel_type: 'diesel',
        curb_weight_kg: 8000,
      }),
    );
  });

  it('un semi-remolque no manda combustible', async () => {
    mockGets({});
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      patente: 'ABCD12',
      razon_social: 'Transportes Sur SpA',
      teltonika_imei: IMEI,
    });
    render(<AsociarTeltonika />);
    await llenarAlta({ combustible: 'diesel', tipo: 'semi_remolque', peso: '7000' });
    fireEvent.click(screen.getByTestId('teltonika-habilitar'));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('fuel_type');
  });
});
