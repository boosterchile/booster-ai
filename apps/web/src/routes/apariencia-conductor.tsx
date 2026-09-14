import { useSearch } from '@tanstack/react-router';
import { AssignmentCard, type DriverAssignment } from './conductor.js';

/**
 * /apariencia/conductor — preview de la tarjeta del servicio del Modo Conductor
 * con datos MOCK, por fase (`?fase=por_recoger|en_ruta`) y por tipo de vehículo
 * (`?teltonika=1|0`). Ruta pública sin datos reales, como `/apariencia/shell`:
 * sirve para la revisión visual del PO a tamaño de teléfono sin iniciar sesión
 * y para el E2E de la tarjeta sin backend.
 *
 * Nota: en `en_ruta` sin Teltonika la tarjeta intenta reportar posición como en
 * producción; sin permiso muestra el aviso y el botón de reintento, que es
 * justamente el estado que se quiere revisar.
 */
function mockAssignment(fase: string, teltonika: boolean): DriverAssignment {
  return {
    id: 'preview-asg-1',
    status: fase === 'en_ruta' ? 'recogido' : 'asignado',
    trip: {
      id: 'preview-trip-1',
      tracking_code: 'BOO-DEMO01',
      status: fase === 'en_ruta' ? 'en_proceso' : 'asignado',
      origin: { address_raw: 'Av. Américo Vespucio 1501, Pudahuel', region_code: 'XIII' },
      destination: { address_raw: 'Ruta 5 Norte km 470, La Serena', region_code: 'IV' },
      cargo_type: 'carga_seca',
      cargo_weight_kg: 8000,
      pickup_window_start: '2026-09-15T18:15:00.000Z',
      pickup_window_end: '2026-09-15T22:00:00.000Z',
    },
    carrier_empresa: { id: 'preview-emp-1', legal_name: 'Transportes Demo Sur S.A.' },
    vehicle: {
      id: 'preview-veh-1',
      plate: teltonika ? 'JLKT54' : 'KFHC70',
      has_teltonika: teltonika,
    },
  };
}

export function AparienciaConductorRoute() {
  // El router parsea `teltonika=0` como número 0: se compara como string.
  const search = (useSearch({ strict: false }) ?? {}) as { fase?: unknown; teltonika?: unknown };
  const fase = search.fase === 'en_ruta' ? 'en_ruta' : 'por_recoger';
  const teltonika = String(search.teltonika ?? '1') !== '0';

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white pt-safe">
        <div className="mx-auto max-w-2xl px-4 py-3 sm:px-6">
          <div className="text-neutral-500 text-xs">Preview · Modo Conductor</div>
          <div className="font-semibold text-neutral-900">Tarjeta del servicio</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
        <p className="mb-3 text-neutral-600 text-sm" data-testid="preview-descripcion">
          Datos de ejemplo. Fase: <span className="font-medium">{fase}</span> · Vehículo{' '}
          <span className="font-medium">{teltonika ? 'con' : 'sin'}</span> Teltonika.
        </p>
        <AssignmentCard assignment={mockAssignment(fase, teltonika)} geoPermission="prompt" />
      </main>
    </div>
  );
}
