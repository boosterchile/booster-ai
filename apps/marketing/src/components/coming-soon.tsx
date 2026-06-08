const SUPPORT_EMAIL = 'soporte@boosterchile.com';

/**
 * Estado "próximamente" de `/signup` cuando el kill-switch
 * `NEXT_PUBLIC_SIGNUP_ENABLED` está off (default). No monta formulario: no se
 * captan solicitudes hasta que el flujo de aprobación esté completo
 * (ver `.specs/marketing-site-signup-request/`). Ofrece un canal de contacto
 * directo en vez de prometer un email automático que aún no se envía (OQ2).
 */
export function ComingSoon() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="font-bold text-2xl text-neutral-900">Estamos abriendo el acceso por etapas</h1>
      <p className="mt-4 text-neutral-600">
        El registro en línea estará disponible muy pronto. Si quieres sumarte a Booster como
        transportista o generador de carga, escríbenos y te contactamos para coordinar tu acceso.
      </p>
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="mt-6 inline-block font-semibold text-primary-700 text-sm hover:text-primary-800"
      >
        {SUPPORT_EMAIL}
      </a>
    </main>
  );
}
