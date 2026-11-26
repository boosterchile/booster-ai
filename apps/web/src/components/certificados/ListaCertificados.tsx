import { Button } from '@booster-ai/ui-components';
import { Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { CO2E } from '../../lib/formato-emisiones.js';
import type { Medicion, PresentacionHuella } from '../../lib/presentacion-huella.js';
import { CifraHuella } from '../huella/CifraHuella.js';
import { TablaMedicion } from '../huella/TablaMedicion.js';

/** Una fila de `GET /certificates`. */
export interface CertificadoListItem {
  trip_id: string;
  tracking_code: string;
  origin_address: string;
  destination_address: string;
  cargo_type: string;
  kg_co2e: string | null;
  distance_km?: string | null;
  precision_method?: string | null;
  glec_version?: string | null;
  route_data_source?: string | null;
  coverage_pct?: string | null;
  certification_level?: string | null;
  /** ADR-077 §4 — línea de método derivada por el API; se muestra tal cual. */
  linea_metodo?: string | null;
  /** ADR-091, calculada por el API (la misma función que el PDF). Ausente en respuestas viejas. */
  presentacion?: PresentacionHuella;
  /** Qué se midió y el nivel (`.specs/frente2-cierre` §3.1). Ausente en respuestas viejas. */
  medicion?: Medicion;
  certificate_sha256?: string | null;
  certificate_kms_key_version?: string | null;
  certificate_issued_at: string | null;
  // ADR-021 §6.4 — empty backhaul allocation. Null para certs legacy
  // o trips sin perfil energético del vehículo.
  factor_matching_aplicado?: string | null;
  ahorro_co2e_vs_sin_matching_kgco2e?: string | null;
}

export interface ListaCertificadosProps {
  certificados: CertificadoListItem[];
  onDescargar: (tripId: string) => void;
  /** Viaje cuyo certificado se está abriendo. */
  descargando: string | null;
}

/**
 * Certificados emitidos (`.specs/sello-huella-toda-la-web`). En escritorio es
 * una tabla; bajo 640 px cada certificado es una tarjeta, para que la cifra y
 * su sello se vean sin desplazar a lo ancho.
 */
export function ListaCertificados({
  certificados,
  onDescargar,
  descargando,
}: ListaCertificadosProps) {
  return (
    <>
      <ul className="mt-6 space-y-3 sm:hidden" aria-label="Certificados emitidos">
        {certificados.map((c) => (
          <li
            key={c.trip_id}
            className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
            data-testid={`certificado-tarjeta-${c.tracking_code}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="whitespace-nowrap font-mono font-semibold text-neutral-900">
                {c.tracking_code}
              </span>
              <span className="text-neutral-500 text-xs">{emitido(c)}</span>
            </div>
            <Trayecto c={c} className="mt-2" />
            <div className="mt-3 border-neutral-100 border-t pt-3">
              <p className="font-medium text-neutral-500 text-xs">Huella del viaje</p>
              <Huella c={c} className="mt-1 font-semibold text-base text-neutral-900" />
              <Ahorro c={c} className="mt-2" />
            </div>
            <BotonDescarga c={c} onDescargar={onDescargar} descargando={descargando} />
          </li>
        ))}
      </ul>

      <div className="mt-6 hidden overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm sm:block">
        <table className="min-w-full divide-y divide-neutral-200">
          <thead className="bg-neutral-50">
            <tr>
              <Th>Código</Th>
              <Th>Trayecto</Th>
              <Th>{CO2E}</Th>
              <Th>Emitido</Th>
              <Th className="text-right">Acción</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {certificados.map((c) => (
              <tr key={c.trip_id} className="hover:bg-neutral-50">
                <Td className="whitespace-nowrap font-mono font-semibold text-neutral-900">
                  {c.tracking_code}
                </Td>
                <Td>
                  <Trayecto c={c} />
                </Td>
                <Td className="min-w-56">
                  <Huella c={c} className="font-semibold text-neutral-900" />
                  <Ahorro c={c} className="mt-1.5" />
                </Td>
                <Td className="whitespace-nowrap text-neutral-600 text-xs">{emitido(c)}</Td>
                <Td className="text-right">
                  <BotonDescarga c={c} onDescargar={onDescargar} descargando={descargando} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Trayecto({ c, className = '' }: { c: CertificadoListItem; className?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 text-xs ${className}`}>
      <span className="text-neutral-800">{c.origin_address}</span>
      <span className="text-neutral-500">→ {c.destination_address}</span>
      <span className="text-neutral-500">{formatCargoType(c.cargo_type)}</span>
      {c.linea_metodo && (
        <span className="text-neutral-500" title="Método de cálculo (ADR-077)">
          {c.linea_metodo}
        </span>
      )}
      {c.medicion && (
        <details className="mt-1">
          <summary className="cursor-pointer font-medium text-neutral-700">
            Qué se midió · {c.medicion.nivel.nombre}
          </summary>
          <div className="mt-2">
            <TablaMedicion medicion={c.medicion} />
          </div>
        </details>
      )}
    </div>
  );
}

/** La cifra del certificado: número arriba y sello debajo, igual en las tres presentaciones. */
function Huella({ c, className = '' }: { c: CertificadoListItem; className?: string }) {
  return (
    <CifraHuella
      valor={c.kg_co2e}
      presentacion={c.presentacion ?? 'estimado'}
      disposicion="apilada"
      className={className}
    />
  );
}

/** Ahorro por matching (ADR-021 §6.4): misma presentación que el certificado. */
function Ahorro({ c, className = '' }: { c: CertificadoListItem; className?: string }) {
  const ahorro = Number(c.ahorro_co2e_vs_sin_matching_kgco2e ?? 0);
  if (!(ahorro > 0)) {
    return null;
  }
  return (
    <div className={`text-xs ${className}`}>
      <span className="text-neutral-500">Ahorro por matching </span>
      <CifraHuella
        valor={ahorro}
        presentacion={c.presentacion ?? 'estimado'}
        className="font-medium text-emerald-700"
      />
    </div>
  );
}

function BotonDescarga({
  c,
  onDescargar,
  descargando,
}: {
  c: CertificadoListItem;
  onDescargar: (tripId: string) => void;
  descargando: string | null;
}) {
  const abriendo = descargando === c.trip_id;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => onDescargar(c.trip_id)}
      disabled={abriendo}
      className="mt-3 w-full sm:mt-0 sm:w-auto"
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      {abriendo ? 'Abriendo…' : 'Descargar'}
    </Button>
  );
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2 text-left font-medium text-neutral-500 text-xs uppercase tracking-wider ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-3 align-top text-neutral-800 text-sm ${className}`}>{children}</td>
  );
}

function emitido(c: CertificadoListItem): string {
  if (!c.certificate_issued_at) {
    return '—';
  }
  return new Intl.DateTimeFormat('es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Santiago',
  }).format(new Date(c.certificate_issued_at));
}

function formatCargoType(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}
