import {
  consultarInvitacionCorreoResponseSchema,
  crearCuentaInvitacionResponseSchema,
  crearCuentaInvitacionSchema,
  ensureRutHasDash,
} from '@booster-ai/shared-schemas';
import { useNavigate } from '@tanstack/react-router';
import { KeyRound, Loader2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { signInUniversalWithCustomToken } from '../hooks/use-auth.js';
import { getApiUrl } from '../lib/api-url.js';
import { logger } from '../lib/logger.js';

/**
 * `/crear-cuenta` — UI Booster de creación tras invitación por correo
 * (ADR-093). Pública: autentica con el token de la URL, no con sesión.
 *
 * El mail puede traer `?token=` en la PWA; el cliente lo reenvía al API en
 * header `x-invite-token` (nunca como query del API — Cloud Run logs).
 */

const INVITE_TOKEN_HEADER = 'x-invite-token';

function tokenDeLaUrl(): string {
  return new URLSearchParams(window.location.search).get('token')?.trim() ?? '';
}

export function CrearCuentaRoute() {
  const navigate = useNavigate();
  const [token] = useState(tokenDeLaUrl);
  const [email, setEmail] = useState<string | null>(null);
  const [tipo, setTipo] = useState<'personal_booster' | 'stakeholder' | null>(null);
  const [cargandoInvitacion, setCargandoInvitacion] = useState(true);
  const [invitacionError, setInvitacionError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [rut, setRut] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listaSinSesion, setListaSinSesion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function cargar() {
      if (token.length < 32) {
        setInvitacionError('Este enlace de invitación no es válido o ya expiró.');
        setCargandoInvitacion(false);
        return;
      }
      try {
        const res = await fetch(`${getApiUrl()}/auth/invitar-cuenta`, {
          headers: { [INVITE_TOKEN_HEADER]: token },
        });
        if (!res.ok) {
          if (!cancelled) {
            setInvitacionError('Este enlace de invitación no es válido o ya expiró.');
          }
          return;
        }
        const parsed = consultarInvitacionCorreoResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          if (!cancelled) {
            setInvitacionError('No pudimos leer la invitación. Pide un enlace nuevo.');
          }
          return;
        }
        if (!cancelled) {
          setEmail(parsed.data.email);
          setTipo(parsed.data.tipo);
        }
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.name : 'desconocido' },
          'crear-cuenta: fallo al consultar invitación',
        );
        if (!cancelled) {
          setInvitacionError('No pudimos conectar con el servidor. Intenta de nuevo.');
        }
      } finally {
        if (!cancelled) {
          setCargandoInvitacion(false);
        }
      }
    }
    void cargar();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = crearCuentaInvitacionSchema.safeParse({
      token,
      full_name: fullName,
      password,
      password_confirm: passwordConfirm,
      rut: ensureRutHasDash(rut),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos del formulario.');
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch(`${getApiUrl()}/auth/invitar-cuenta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (res.status === 410) {
        setError('Este enlace de invitación no es válido o ya expiró.');
        return;
      }
      if (res.status === 409) {
        const body = (await res.json()) as { code?: string };
        if (body.code === 'rut_already_registered') {
          setError('Ese RUT ya está registrado en Booster.');
          return;
        }
        if (body.code === 'email_already_registered') {
          setError('Ese correo ya tiene una cuenta. Entra con correo y clave.');
          return;
        }
        setError('No se pudo crear la cuenta. Revisa los datos.');
        return;
      }
      if (!res.ok) {
        setError(`Error inesperado (${res.status}). Intenta de nuevo.`);
        return;
      }

      const bodyParsed = crearCuentaInvitacionResponseSchema.safeParse(await res.json());
      if (!bodyParsed.success) {
        setError('Cuenta creada, pero la respuesta fue inesperada. Entra por /login.');
        setListaSinSesion(true);
        return;
      }

      if (bodyParsed.data.custom_token) {
        await signInUniversalWithCustomToken(bodyParsed.data.custom_token);
        void navigate({ to: '/app' });
        return;
      }

      setListaSinSesion(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al conectar con el servidor.');
    } finally {
      setEnviando(false);
    }
  }

  if (cargandoInvitacion) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" aria-label="Cargando" />
      </div>
    );
  }

  if (invitacionError || !email || !tipo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
        <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h1 className="font-semibold text-neutral-900 text-xl">Invitación no válida</h1>
          <p className="mt-2 text-neutral-600 text-sm">
            {invitacionError ?? 'Pide un enlace nuevo al administrador de Booster.'}
          </p>
          <a
            href="/login?tipo=booster"
            className="mt-4 inline-block text-primary-600 text-sm hover:underline"
          >
            Ir al login
          </a>
        </div>
      </div>
    );
  }

  if (listaSinSesion) {
    const loginTipo = tipo === 'stakeholder' ? 'stakeholder' : 'booster';
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
        <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h1 className="font-semibold text-neutral-900 text-xl">Cuenta lista</h1>
          <p className="mt-2 text-neutral-600 text-sm">
            Ya puedes entrar con tu correo y la clave que elegiste.
          </p>
          <a
            href={`/login?tipo=${loginTipo}`}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700"
          >
            Ir al login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <div
        className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
        data-testid="crear-cuenta-form"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-700">
            <KeyRound className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="font-semibold text-neutral-900">Crea tu cuenta</h1>
            <p className="text-neutral-500 text-xs">
              {tipo === 'stakeholder' ? 'Stakeholder' : 'Personal Booster'}
            </p>
          </div>
        </div>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div>
            <label className="block font-medium text-neutral-700 text-sm" htmlFor="crear-email">
              Correo
            </label>
            <input
              id="crear-email"
              type="email"
              value={email}
              readOnly
              className="mt-1 w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-neutral-700 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-700 text-sm" htmlFor="crear-nombre">
              Nombre completo
            </label>
            <input
              id="crear-nombre"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              required
              minLength={2}
              maxLength={200}
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-700 text-sm" htmlFor="crear-rut">
              RUT
            </label>
            <input
              id="crear-rut"
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              autoComplete="off"
              placeholder="12.345.678-5"
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-700 text-sm" htmlFor="crear-clave">
              Clave
            </label>
            <input
              id="crear-clave"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              required
              minLength={8}
            />
            <p className="mt-1 text-neutral-500 text-xs">
              Mínimo 8 caracteres (no uses solo 6 dígitos).
            </p>
          </div>
          <div>
            <label
              className="block font-medium text-neutral-700 text-sm"
              htmlFor="crear-clave-confirm"
            >
              Confirmar clave
            </label>
            <input
              id="crear-clave-confirm"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              required
              minLength={8}
            />
          </div>

          {error ? (
            <p className="text-danger-700 text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={enviando}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Crear cuenta
          </button>
        </form>
      </div>
    </div>
  );
}
