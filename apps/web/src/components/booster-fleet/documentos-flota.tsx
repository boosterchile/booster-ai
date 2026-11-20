import type { PanelBoosterFleet } from '@booster-ai/shared-schemas';
import { Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { MarcaTono, Patente } from './etiqueta-severidad.js';
import { type HallazgoDocumental, TONO_DOCUMENTO, contar } from './reglas.js';

const VISIBLES = 6;
const ENLACE = 'whitespace-nowrap font-medium text-primary-700 text-sm hover:underline';

/** Un documento pendiente, con el enlace a la ficha donde se resuelve. */
export function AlertaDocumental({ hallazgo }: { hallazgo: HallazgoDocumental }) {
  const nombre = hallazgo.de === 'vehiculo' ? `la patente ${hallazgo.quien}` : hallazgo.quien;
  const etiqueta = `Abrir ficha de ${nombre}`;
  return (
    <li className="flex items-center justify-between gap-3 border-neutral-200 border-t px-4 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium text-neutral-900 text-sm">
          <MarcaTono tono={TONO_DOCUMENTO[hallazgo.estado]} />
          {hallazgo.de === 'vehiculo' ? <Patente>{hallazgo.quien}</Patente> : hallazgo.quien}
        </div>
        <p className="mt-0.5 text-neutral-600 text-xs">
          <span className="font-semibold text-neutral-900">{hallazgo.documento}</span> ·{' '}
          {hallazgo.texto}
        </p>
      </div>
      {hallazgo.de === 'vehiculo' ? (
        <Link
          to="/app/vehiculos/$id"
          params={{ id: hallazgo.id }}
          aria-label={etiqueta}
          className={ENLACE}
        >
          Abrir ficha
        </Link>
      ) : (
        <Link
          to="/app/conductores/$id"
          params={{ id: hallazgo.id }}
          aria-label={etiqueta}
          className={ENLACE}
        >
          Abrir ficha
        </Link>
      )}
    </li>
  );
}

/**
 * Documentos pendientes de vehículos y conductores, ya ordenados. Muestra
 * seis y despliega el resto en el mismo lugar. No sube ni edita archivos.
 */
export function DocumentosFlota({
  documental,
  hallazgos,
}: {
  documental: PanelBoosterFleet['documental'];
  hallazgos: readonly HallazgoDocumental[];
}) {
  const [todos, setTodos] = useState(false);
  const visibles = todos ? hallazgos : hallazgos.slice(0, VISIBLES);
  const alDia = documental.vehiculos_al_dia + documental.conductores_al_dia;

  return (
    <section
      aria-labelledby="documentos-titulo"
      className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2
          id="documentos-titulo"
          className="flex items-center gap-2 font-semibold text-neutral-900"
        >
          <FileText className="h-4 w-4" aria-hidden /> Documentos
        </h2>
        <p className="text-neutral-600 text-xs">
          {contar(documental.vehiculos_con_hallazgo, 'vehículo', 'vehículos')} ·{' '}
          {contar(documental.conductores_con_hallazgo, 'conductor', 'conductores')}
        </p>
      </div>
      {hallazgos.length === 0 ? (
        <p className="border-neutral-200 border-t px-4 py-4 text-neutral-600 text-sm">
          Sin documentos pendientes.
        </p>
      ) : (
        <ul>
          {visibles.map((hallazgo) => (
            <AlertaDocumental key={hallazgo.clave} hallazgo={hallazgo} />
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-3 border-neutral-200 border-t px-4 py-2.5">
        {hallazgos.length > VISIBLES ? (
          <button
            type="button"
            aria-expanded={todos}
            onClick={() => setTodos((valor) => !valor)}
            className="font-medium text-primary-700 text-sm hover:underline"
          >
            {todos ? 'Ver menos' : `Ver los ${hallazgos.length} pendientes`}
          </button>
        ) : (
          <span />
        )}
        <span className="text-neutral-500 text-xs">{alDia} al día</span>
      </div>
    </section>
  );
}
