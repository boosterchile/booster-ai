import { ChevronDown, ChevronUp, Gauge, Info, Sparkles } from 'lucide-react';
import { useState } from 'react';
import {
  type BehaviorScoreResponse,
  type CoachingResponse,
  type NivelScore,
  useBehaviorScore,
  useCoaching,
} from '../../hooks/use-behavior-score.js';
import { CoachingVoicePlayer } from './CoachingVoicePlayer.js';

/**
 * Card que muestra el behavior score del trip (Phase 2 PR-I5).
 *
 * Estados:
 *   - Cargando: skeleton compacto
 *   - status: 'no_disponible': mensaje educativo según reason — el carrier
 *     entiende qué hacer para tener score
 *   - status: 'disponible': score grande con badge cualitativo + drill-down
 *     colapsable de los counts por tipo de evento
 *
 * Diseñado para ir encima de la ChatPanel en asignacion-detalle. Compacta
 * por default (~80px), expansible a ~200px con detalles.
 */

const NIVEL_STYLES: Record<NivelScore, { label: string; bg: string; text: string; ring: string }> =
  {
    excelente: {
      label: 'Excelente',
      bg: 'bg-success-50',
      text: 'text-success-700',
      ring: 'ring-success-700/20',
    },
    bueno: {
      label: 'Bueno',
      bg: 'bg-primary-50',
      text: 'text-primary-700',
      ring: 'ring-primary-700/20',
    },
    regular: {
      label: 'Regular',
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      ring: 'ring-amber-700/20',
    },
    malo: {
      label: 'Mejorar',
      bg: 'bg-danger-50',
      text: 'text-danger-700',
      ring: 'ring-danger-700/20',
    },
  };

export interface BehaviorScoreCardProps {
  assignmentId: string;
}

export function BehaviorScoreCard({ assignmentId }: BehaviorScoreCardProps) {
  const query = useBehaviorScore(assignmentId);
  // Coaching IA — fetch en paralelo. Solo se muestra si está disponible.
  // Si Gemini está caído y cae a plantilla, igual se muestra (la fuente
  // se indica con icono pero el contenido es accionable de cualquier forma).
  const coachingQuery = useCoaching(assignmentId);
  const [expanded, setExpanded] = useState(false);

  if (query.isLoading) {
    return (
      <div className="border-neutral-200 border-b bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <Gauge className="h-5 w-5 animate-pulse text-neutral-400" aria-hidden />
          <div className="text-neutral-500 text-sm">Cargando score de conducción…</div>
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    // Silencioso. No queremos meter ruido si la query falla — el chat es
    // lo importante en esta surface.
    return null;
  }

  const data: BehaviorScoreResponse = query.data;

  if (data.status === 'no_disponible') {
    return (
      <div className="border-neutral-200 border-b bg-neutral-50 px-4 py-3">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 shrink-0 text-neutral-500" aria-hidden />
          <div className="flex-1">
            <p className="font-medium text-neutral-900 text-sm">
              Score de conducción no disponible
            </p>
            <p className="mt-0.5 text-neutral-600 text-xs">
              Activa Teltonika en este vehículo para recibir feedback automático sobre estilo de
              conducción tras cada entrega.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // status === 'disponible'
  const styles = NIVEL_STYLES[data.nivel];
  const breakdown = data.breakdown;

  return (
    <div className="border-neutral-200 border-b bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 transition hover:bg-neutral-50"
        aria-expanded={expanded}
        aria-controls="behavior-score-details"
      >
        <Gauge className={`h-5 w-5 ${styles.text}`} aria-hidden />
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-900 text-sm">
              Score de conducción · {data.score.toFixed(0)}/100
            </span>
            <span
              className={`rounded-full px-2 py-0.5 font-medium text-xs ring-1 ${styles.bg} ${styles.text} ${styles.ring}`}
            >
              {styles.label}
            </span>
          </div>
          <p className="mt-0.5 text-neutral-500 text-xs">
            {breakdown.eventosPorHora > 0
              ? `${breakdown.eventosPorHora.toFixed(1)} eventos/hora · ${
                  breakdown.aceleracionesBruscas +
                  breakdown.frenadosBruscos +
                  breakdown.curvasBruscas +
                  breakdown.excesosVelocidad
                } eventos totales`
              : 'Sin eventos en este viaje'}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-neutral-400" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 text-neutral-400" aria-hidden />
        )}
      </button>

      {expanded && (
        <div
          id="behavior-score-details"
          className="border-neutral-100 border-t bg-neutral-50 px-4 py-3"
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <BreakdownItem label="Aceleración brusca" value={breakdown.aceleracionesBruscas} />
            <BreakdownItem label="Frenado brusco" value={breakdown.frenadosBruscos} />
            <BreakdownItem label="Curva brusca" value={breakdown.curvasBruscas} />
            <BreakdownItem label="Exceso velocidad" value={breakdown.excesosVelocidad} />
          </dl>
          {/* Phase 3 PR-J3 — coaching IA. Se muestra dentro del drill-down
              (no en el header colapsado) para que el usuario tenga foco
              en el score primero, luego lee el feedback. */}
          {coachingQuery.data && coachingQuery.data.status === 'disponible' && (
            <CoachingMessage data={coachingQuery.data} />
          )}
          <p className="mt-3 text-[11px] text-neutral-500">
            Score basado en metodología GLEC + estudios SAE eco-driving. Reducir frenadas y
            arrancadas bruscas baja el consumo de combustible 5–15%.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Mensaje de coaching IA (Phase 3 PR-J3). Distingue visualmente si vino
 * de Gemini (✨ Sparkles) o de plantilla determinística (icono Info más
 * sobrio). Tono visual consistente: borde primary, fondo neutro claro,
 * mensaje en negro neutral.
 */
function CoachingMessage({
  data,
}: {
  data: Extract<CoachingResponse, { status: 'disponible' }>;
}) {
  const sourceLabel =
    data.source === 'gemini' ? 'Sugerencia personalizada (IA)' : 'Sugerencia general';
  return (
    <section
      aria-label="Coaching de conducción"
      className="mt-3 rounded-md border border-primary-200 bg-white p-3"
    >
      <header className="mb-1.5 flex items-center gap-1.5 text-primary-700 text-xs">
        {data.source === 'gemini' ? (
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Info className="h-3.5 w-3.5" aria-hidden />
        )}
        <span className="font-semibold">{sourceLabel}</span>
      </header>
      <p className="text-neutral-800 text-sm leading-snug">{data.message}</p>
      {/* Phase 3 PR-J3 — voice delivery hands-free. Botón único play/stop
          + checkbox de auto-play persistido. Si el browser no soporta
          speechSynthesis (rarísimo), el componente se oculta y queda
          sólo el texto. */}
      <CoachingVoicePlayer message={data.message} />
    </section>
  );
}

function BreakdownItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd
        className={`font-semibold ${
          value === 0 ? 'text-success-700' : value <= 2 ? 'text-amber-700' : 'text-danger-700'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
