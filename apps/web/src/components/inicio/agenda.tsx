import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { PlateTag, StatusPill } from './piezas.js';

export interface AgendaItem {
  id: string;
  dia: string;
  hora: string;
  titulo: string;
  codigo: string | null;
  transportista: string | null;
  estado: string | null;
  tono: 'neutral' | 'info' | 'warning' | 'success' | 'danger';
  avancePct: number | null;
  precio: string | null;
  href: string;
  etiqueta: 'Transporte' | 'Mi carga' | null;
  accion?: { label: string; href: string } | null;
}

const MOVIL = 3;

function tonoEtiqueta(etiqueta: AgendaItem['etiqueta']): 'success' | 'info' {
  return etiqueta === 'Transporte' ? 'success' : 'info';
}

function Cuerpo({ item }: { item: AgendaItem }) {
  return (
    <>
      <div className="w-14 shrink-0">
        <p className="font-semibold text-neutral-900 text-sm tabular-nums">{item.hora}</p>
        <p className="text-neutral-500 text-xs uppercase">{item.dia}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-neutral-900 text-sm">{item.titulo}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1 text-neutral-600 text-xs">
          {item.codigo ? <PlateTag plate={item.codigo} /> : null}
          {item.etiqueta ? (
            <StatusPill tono={tonoEtiqueta(item.etiqueta)}>{item.etiqueta}</StatusPill>
          ) : null}
          {item.transportista ? <span>{item.transportista}</span> : null}
          {item.estado ? (
            <StatusPill tono={item.tono}>
              {item.estado}
              {item.avancePct != null ? ` · ${item.avancePct}%` : ''}
            </StatusPill>
          ) : null}
        </p>
      </div>
    </>
  );
}

function Fila({ item }: { item: AgendaItem }) {
  if (item.accion) {
    return (
      <li className="flex items-center gap-3 py-2">
        <Cuerpo item={item} />
        <Link
          to={item.accion.href}
          className="shrink-0 rounded-md bg-primary-600 px-2.5 py-1 font-semibold text-white text-xs"
        >
          {item.accion.label}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <Link to={item.href} className="flex items-center gap-3 py-2">
        <Cuerpo item={item} />
        <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
      </Link>
    </li>
  );
}

export function AgendaList({ items }: { items: AgendaItem[] }) {
  return (
    <ul data-testid="agenda-movil" className="md:hidden">
      {items.slice(0, MOVIL).map((item) => (
        <Fila key={item.id} item={item} />
      ))}
    </ul>
  );
}

export function AgendaTable({ items }: { items: AgendaItem[] }) {
  return (
    <div data-testid="agenda-desktop" className="hidden overflow-x-auto md:block">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-neutral-500 text-xs">
            <th className="pr-3 pb-2 font-semibold">Cuándo</th>
            <th className="pr-3 pb-2 font-semibold">Ruta</th>
            <th className="pr-3 pb-2 font-semibold">Carga</th>
            <th className="pr-3 pb-2 font-semibold">Transportista</th>
            <th className="pr-3 pb-2 font-semibold">Estado</th>
            <th className="pb-2 font-semibold">Precio</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-neutral-100 border-b">
              <td className="py-2 pr-3 font-semibold text-sm">
                {item.dia} {item.hora}
              </td>
              <td className="py-2 pr-3 text-sm">{item.titulo}</td>
              <td className="py-2 pr-3 text-sm">
                <span className="inline-flex flex-wrap items-center gap-1">
                  {item.codigo ?? '—'}
                  {item.etiqueta ? (
                    <StatusPill tono={tonoEtiqueta(item.etiqueta)}>{item.etiqueta}</StatusPill>
                  ) : null}
                </span>
              </td>
              <td className="py-2 pr-3 text-sm">{item.transportista ?? '—'}</td>
              <td className="py-2 pr-3 text-sm">
                {item.estado ? (
                  <StatusPill tono={item.tono}>
                    {item.estado}
                    {item.avancePct != null ? ` · ${item.avancePct}%` : ''}
                  </StatusPill>
                ) : (
                  '—'
                )}
                {item.accion ? (
                  <Link
                    to={item.accion.href}
                    className="ml-2 rounded-md bg-primary-600 px-2.5 py-1 font-semibold text-white text-xs"
                  >
                    {item.accion.label}
                  </Link>
                ) : null}
              </td>
              <td className="py-2 text-sm">{item.precio ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
