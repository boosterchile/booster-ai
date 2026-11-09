import {
  CONFIRMACION_ACCESO_BOOSTER_VIGENCIA_HORAS,
  confirmarAccesoBoosterResponseSchema,
  confirmarAccesoBoosterSchema,
} from '@booster-ai/shared-schemas';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2, ShieldCheck } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';
import { logger } from '../lib/logger.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * `/app/confirmar-acceso-booster` (`.specs/confirmar-acceso-booster` SC18).
 *
 * Cuando el panel del personal da de alta a alguien cuya cuenta ya es de una
 * empresa, el acceso al panel de Booster lo confirma la propia persona, con su
 * sesión iniciada, ingresando el código que el admin le entregó en persona.
 * Al confirmar, `/me` se vuelve a pedir y la persona sigue al panel.
 */
export function ConfirmarAccesoBoosterRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => (ctx.kind === 'onboarded' ? <ConfirmarAccesoBoosterPage me={ctx.me} /> : null)}
    </ProtectedRoute>
  );
}

/**
 * El API responde lo mismo a un código incorrecto, vencido, sin intentos o
 * inexistente; la pantalla tampoco distingue.
 */
const CODIGO_NO_SIRVE = 'El código no es válido o venció. Pide uno nuevo al equipo de Booster.';
const MENSAJE_FORMATO = 'El código tiene 6 números';

/** Texto del error de la confirmación. Nunca registra el código. */
function mensajeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) {
      return CODIGO_NO_SIRVE;
    }
    if (err.code === 'forbidden_impersonation_write') {
      return 'Estás viendo la plataforma como otra persona. El acceso lo confirma la persona con su propia sesión: sal de la impersonación.';
    }
    if (err.status === 401) {
      return 'Tu sesión venció. Vuelve a iniciar sesión.';
    }
    logger.error(
      { status: err.status, code: err.code },
      'confirmar-acceso-booster: el servidor no confirmó el acceso',
    );
    return `No pudimos confirmar el acceso (${err.status}). Intenta de nuevo en un momento.`;
  }
  logger.error(
    { err_name: err instanceof Error ? err.name : typeof err },
    'confirmar-acceso-booster: la confirmación falló sin respuesta del servidor',
  );
  return 'No pudimos confirmar el acceso. Revisa tu conexión e intenta de nuevo.';
}

function ConfirmarAccesoBoosterPage({ me }: { me: MeOnboarded }) {
  return (
    <Layout me={me} title="Confirmar acceso de Booster">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 shrink-0 text-primary-700" aria-hidden />
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Confirmar acceso de Booster
          </h1>
        </div>
        {me.user.is_platform_admin ? (
          <div
            className="mt-6 rounded-lg border border-success-200 bg-success-50 p-4 text-sm"
            data-testid="confirmar-acceso-con-acceso"
          >
            <p className="font-medium text-success-700">
              Tu cuenta ya tiene acceso al panel de Booster.
            </p>
            <Link
              to="/app/platform-admin"
              className="mt-3 inline-flex rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
            >
              Ir al panel de Booster
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-2 text-neutral-600 text-sm">
              {`Si el equipo de Booster te dio acceso a su panel de administración, te entregó en persona un código de 6 números. Ingrésalo aquí con tu sesión iniciada. Vence ${CONFIRMACION_ACCESO_BOOSTER_VIGENCIA_HORAS} horas después de que te lo entregan.`}
            </p>
            <p className="mt-2 text-neutral-600 text-sm">
              Si nadie de Booster te entregó un código, no tienes que hacer nada aquí: tu cuenta
              sigue igual.
            </p>
            <FormularioConfirmacion />
          </>
        )}
      </div>
    </Layout>
  );
}

function FormularioConfirmacion() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const campoId = useId();
  const ayudaId = useId();
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = confirmarAccesoBoosterSchema.safeParse({ codigo });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? MENSAJE_FORMATO);
      return;
    }
    setEnviando(true);
    try {
      const respuesta = confirmarAccesoBoosterResponseSchema.safeParse(
        await api.post<unknown>('/me/confirmar-acceso-booster', parsed.data),
      );
      if (!respuesta.success) {
        // Solo qué campos fallaron: la respuesta no trae el código, pero el
        // reporte no lleva valores.
        logger.error(
          {
            problemas: respuesta.error.issues.map(
              (issue) => `${issue.path.join('.')}:${issue.code}`,
            ),
          },
          'confirmar-acceso-booster: respuesta del servidor con formato inesperado',
        );
        setError(
          'La respuesta del servidor no tiene el formato esperado. Recarga la página para ver si tu acceso quedó confirmado.',
        );
        return;
      }
      // El acceso rige desde la request siguiente: `/me` trae `is_platform_admin`.
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      void navigate({ to: '/app/platform-admin' });
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={confirmar}
      noValidate
      className="mt-6 space-y-4 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={campoId} className="font-medium text-neutral-700 text-sm">
          Código de confirmación
        </label>
        <input
          id={campoId}
          aria-describedby={ayudaId}
          type="text"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="rounded-md border border-neutral-300 px-3 py-2 text-center font-mono text-lg tracking-[0.3em] focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          placeholder="000000"
        />
        <span id={ayudaId} className="text-neutral-500 text-xs">
          Los 6 números que te entregó en persona el equipo de Booster.
        </span>
      </div>

      {error !== null && (
        <div
          role="alert"
          className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
      >
        {enviando ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Confirmando…
          </>
        ) : (
          'Confirmar acceso'
        )}
      </button>
    </form>
  );
}
