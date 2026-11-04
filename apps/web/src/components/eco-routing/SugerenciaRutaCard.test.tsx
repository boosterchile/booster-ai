import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const responder = vi.fn(async () => ({ ok: true }));
const estado = vi.hoisted(() => ({ sugerencia: null as unknown }));
vi.mock('../../hooks/use-sugerencia-ruta.js', () => ({
  useSugerenciaRutaActiva: () => ({ data: { sugerencia: estado.sugerencia } }),
  useResponderSugerenciaRuta: () => ({ mutateAsync: responder, isPending: false }),
}));

const { SugerenciaRutaCard } = await import('./SugerenciaRutaCard.js');

const SUGERENCIA = {
  id: 's-1',
  motivo: 'emisiones',
  polyline_alternativa: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
  ahorro_segundos: 300,
  ahorro_kgco2e: 4.2,
  detectada_en: '2026-10-08T15:00:00.000Z',
  texto: 'Hay una ruta alternativa: 5 min menos y 4,2 kg CO₂e menos.',
};

beforeEach(() => {
  vi.clearAllMocks();
  estado.sugerencia = SUGERENCIA;
});

describe('SugerenciaRutaCard (T10-23)', () => {
  it('sin sugerencia no renderiza nada', () => {
    estado.sugerencia = null;
    const { container } = render(
      <SugerenciaRutaCard assignmentId="a-1" destinoDireccion="Viña" destinoCoords={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('muestra el texto y el aviso de congestión como alerta accesible', () => {
    render(<SugerenciaRutaCard assignmentId="a-1" destinoDireccion="Viña" destinoCoords={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Congestión en tu ruta');
    expect(screen.getByText(SUGERENCIA.texto)).toBeInTheDocument();
  });

  it('Aceptar registra la respuesta y deja el enlace de navegación por la alternativa', async () => {
    render(
      <SugerenciaRutaCard
        assignmentId="a-1"
        destinoDireccion="Viña"
        destinoCoords={{ lat: -33, lng: -71.5 }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar ruta alternativa' }));
    await waitFor(() =>
      expect(responder).toHaveBeenCalledWith({ sugerenciaId: 's-1', respuesta: 'aceptada' }),
    );
    const link = await screen.findByRole('link', { name: 'Navegar por la ruta alternativa' });
    expect(link.getAttribute('href')).toContain('waypoints=40.7%2C-120.95');
  });

  it('Seguir mi ruta registra el rechazo y oculta la tarjeta', async () => {
    const { container } = render(
      <SugerenciaRutaCard assignmentId="a-1" destinoDireccion="Viña" destinoCoords={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Seguir mi ruta' }));
    await waitFor(() =>
      expect(responder).toHaveBeenCalledWith({ sugerenciaId: 's-1', respuesta: 'rechazada' }),
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('respuesta que llega desde la notificación (?respuesta=) se registra sola una vez', async () => {
    render(
      <SugerenciaRutaCard
        assignmentId="a-1"
        destinoDireccion="Viña"
        destinoCoords={null}
        respuestaDesdeNotificacion={{ sugerenciaId: 's-1', respuesta: 'aceptada' }}
      />,
    );
    await waitFor(() =>
      expect(responder).toHaveBeenCalledWith({ sugerenciaId: 's-1', respuesta: 'aceptada' }),
    );
    expect(responder).toHaveBeenCalledTimes(1);
  });

  it('un error al registrar se muestra y permite reintentar', async () => {
    responder.mockRejectedValueOnce(new Error('red'));
    render(<SugerenciaRutaCard assignmentId="a-1" destinoDireccion="Viña" destinoCoords={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seguir mi ruta' }));
    expect(
      await screen.findByText('No pudimos guardar tu respuesta. Intenta de nuevo.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seguir mi ruta' })).toBeEnabled();
  });
});
