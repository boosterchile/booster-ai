import { Badge, Button, Card, CardBody, CardHeader } from '@booster-ai/ui-components';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { signInUniversalWithCustomToken } from '../hooks/use-auth.js';
import { ApiError, api } from '../lib/api-client.js';

/**
 * Picker de impersonación auditada (platform-admin, backend #584). Lista los
 * usuarios de empresas de PRUEBA (`es_demo`) — decisión sellada del PO: no es
 * un buscador de todos los usuarios — y permite "Ver como" cada uno: llama
 * `POST /auth/impersonate` y hace `signInUniversalWithCustomToken`. Tras eso el
 * `onAuthStateChanged` de Firebase re-renderiza la app como el target y el
 * `ImpersonationBanner` (montado en __root) aparece.
 *
 * Con el flag `IMPERSONATION_V1_ACTIVATED` OFF el backend responde 503 → el
 * picker muestra "desactivada" en vez de un error crudo. En D2.
 */

export type PickerState = 'loading' | 'disabled' | 'error' | 'ready';

export interface ImpersonationTarget {
  id: string;
  full_name: string;
  empresa: string;
  role: string;
}

export interface ImpersonationPickerViewProps {
  state: PickerState;
  targets: ImpersonationTarget[];
  impersonatingId: string | null;
  onImpersonate: (id: string) => void;
  /** Mensaje de error del último intento de impersonar; `null` si no hubo. */
  errorMessage?: string | null;
}

/** Presentacional (props). Testeable + axe sin red. */
export function ImpersonationPickerView({
  state,
  targets,
  impersonatingId,
  onImpersonate,
  errorMessage = null,
}: ImpersonationPickerViewProps) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-neutral-900">Ver como usuario</h2>
        <p className="text-neutral-500 text-sm">
          Usuarios de empresas de prueba. Impersonar audita quién actúa como quién.
        </p>
      </CardHeader>
      <CardBody>
        {errorMessage ? (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-danger-700 text-sm"
          >
            {errorMessage}
          </div>
        ) : null}
        {state === 'disabled' ? (
          <p className="text-neutral-600 text-sm">
            La impersonación está <span className="font-medium">desactivada</span>. Activá el flag{' '}
            <code>IMPERSONATION_V1_ACTIVATED</code> para usarla.
          </p>
        ) : state === 'loading' ? (
          <p className="text-neutral-500 text-sm">Cargando usuarios de prueba…</p>
        ) : state === 'error' ? (
          <p className="text-danger-700 text-sm">No pudimos cargar los usuarios de prueba.</p>
        ) : targets.length === 0 ? (
          <p className="text-neutral-500 text-sm">
            No hay usuarios de empresas de prueba. Sembrá el demo primero.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {targets.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-neutral-900">{t.full_name}</div>
                  <div className="flex items-center gap-2 text-neutral-500 text-sm">
                    <span className="truncate">{t.empresa}</span>
                    <Badge>{t.role}</Badge>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => onImpersonate(t.id)}
                  loading={impersonatingId === t.id}
                >
                  Ver como
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Container: fetch + mutación. */
export function ImpersonationPicker() {
  const query = useQuery({
    queryKey: ['impersonate-targets'],
    queryFn: () => api.get<{ targets: ImpersonationTarget[] }>('/auth/impersonate/targets'),
    retry: false,
  });
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const disabled = query.error instanceof ApiError && query.error.status === 503;
  const state: PickerState = disabled
    ? 'disabled'
    : query.isPending
      ? 'loading'
      : query.isError
        ? 'error'
        : 'ready';

  async function onImpersonate(id: string) {
    setImpersonatingId(id);
    setErrorMessage(null);
    try {
      const res = await api.post<{ custom_token: string }>('/auth/impersonate', {
        target_user_id: id,
      });
      // signInWithCustomToken dispara onAuthStateChanged → la app pasa a ser el
      // target y el banner aparece. No navegamos: la sesión cambia sola.
      await signInUniversalWithCustomToken(res.custom_token);
    } catch (err) {
      // No tragar el error: mostrarlo al admin (antes un catch vacío dejaba el
      // botón "sin hacer nada" cuando el backend devolvía 409 o Firebase 400).
      setImpersonatingId(null);
      setErrorMessage(impersonationErrorMessage(err));
    }
  }

  return (
    <ImpersonationPickerView
      state={state}
      targets={query.data?.targets ?? []}
      impersonatingId={impersonatingId}
      onImpersonate={onImpersonate}
      errorMessage={errorMessage}
    />
  );
}

/**
 * Traduce el error de un intento de impersonar a un mensaje para el admin.
 * Prioriza el `message` del cuerpo del error del backend (ej. 409
 * target_account_disabled), luego el código de Firebase, luego genérico.
 */
function impersonationErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.details as { message?: string } | null | undefined;
    if (body?.message) {
      return body.message;
    }
    if (err.code === 'target_account_disabled') {
      return 'La cuenta del usuario está deshabilitada; no se puede impersonar.';
    }
    return `No se pudo impersonar (error ${err.status}).`;
  }
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (code === 'auth/user-disabled') {
    return 'La cuenta del usuario está deshabilitada; no se puede impersonar.';
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `No se pudo impersonar: ${msg}`;
}
