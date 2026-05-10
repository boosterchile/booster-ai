import { Link } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/use-auth.js';
import { useAcceptTermsV2Mutation, useConsentTermsV2 } from '../hooks/use-consent-terms-v2.js';

/**
 * /legal/terminos — Página pública con los Términos de Servicio v2
 * (ADR-031 §4). Si el user está logueado y es carrier sin consent,
 * muestra botón "Acepto"; si ya aceptó, muestra confirmación.
 *
 * No requiere ProtectedRoute: es pública. Pero usa useAuth() para
 * decidir si renderiza el botón de aceptación.
 */
export function LegalTerminosRoute() {
  const { user, loading } = useAuth();
  const consentQ = useConsentTermsV2({ enabled: !!user });
  const acceptM = useAcceptTermsV2Mutation();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="rounded p-1 text-neutral-500 transition hover:bg-neutral-100"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div>
            <h1 className="font-semibold text-neutral-900 text-lg">Términos de Servicio</h1>
            <p className="text-neutral-500 text-xs">Versión 2 · Vigente desde 2026-05-10</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {user &&
          !loading &&
          consentQ.data?.accepted === false &&
          consentQ.data?.reason === 'pending' && (
            <AcceptanceCard
              onAccept={() => acceptM.mutate()}
              isPending={acceptM.isPending}
              isSuccess={acceptM.isSuccess}
              isError={acceptM.isError}
            />
          )}

        {user && !loading && consentQ.data?.accepted && consentQ.data?.accepted_at && (
          <AlreadyAcceptedCard acceptedAt={consentQ.data.accepted_at} />
        )}

        <article className="prose prose-neutral mt-6 max-w-none rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <TermsContent />
        </article>
      </main>
    </div>
  );
}

function AcceptanceCard(props: {
  onAccept: () => void;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
}) {
  return (
    <section
      aria-label="Aceptación de Términos"
      className="rounded-lg border border-primary-200 bg-primary-50 p-4 shadow-sm"
    >
      <h2 className="font-semibold text-neutral-900">Aún no aceptaste estos Términos</h2>
      <p className="mt-1 text-neutral-700 text-sm">
        Para recibir liquidaciones de tus viajes en Booster, necesitamos que aceptes los Términos de
        Servicio v2. Tu aceptación queda registrada con fecha, IP y agente de usuario para fines de
        auditoría.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={props.onAccept}
          disabled={props.isPending || props.isSuccess}
          className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {props.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          )}
          {props.isPending ? 'Registrando aceptación…' : 'Acepto los Términos de Servicio v2'}
        </button>
        {props.isError && (
          <span role="alert" className="text-danger-700 text-sm">
            No pudimos registrar tu aceptación. Intenta de nuevo.
          </span>
        )}
      </div>
    </section>
  );
}

function AlreadyAcceptedCard(props: { acceptedAt: string }) {
  const date = new Date(props.acceptedAt);
  const localized = date.toLocaleString('es-CL', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  });
  return (
    <section
      aria-label="Términos aceptados"
      className="rounded-lg border border-success-500/30 bg-success-50 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success-700" aria-hidden />
        <div>
          <h2 className="font-semibold text-neutral-900">Aceptaste estos Términos</h2>
          <p className="mt-1 text-neutral-700 text-sm">
            Fecha de aceptación: <strong>{localized}</strong>. Esta versión seguirá vigente hasta
            una próxima actualización (te avisaremos con 30 días de antelación si afecta cobros).
          </p>
        </div>
      </div>
    </section>
  );
}

function TermsContent() {
  return (
    <>
      <h2>1. Quiénes somos</h2>
      <p>
        Booster AI (en adelante, <strong>"Booster"</strong>) es operado por Booster Chile SpA, RUT
        XX.XXX.XXX-X, con domicilio en Chile. Para consultas legales escribe a{' '}
        <a href="mailto:soporte@boosterchile.com">soporte@boosterchile.com</a>.
      </p>
      <p>
        Booster opera un marketplace digital B2B que conecta <strong>generadores de carga</strong>{' '}
        con <strong>transportistas</strong>. Estos Términos aplican principalmente a los
        Transportistas que aceptan ofertas y reciben remuneración a través de la plataforma.
      </p>

      <h2>2. Aceptación</h2>
      <p>
        Al hacer click en "Acepto los Términos de Servicio v2" desde tu cuenta, declaras haber
        leído, comprendido y aceptado este documento en su integridad. La aceptación se registra con
        marca temporal, dirección IP y agente de usuario para auditoría.
      </p>

      <h2>3. Operación del marketplace</h2>
      <p>
        El generador publica una solicitud de transporte con precio en pesos chilenos. El algoritmo
        de matching de Booster selecciona transportistas candidatos. Tras la aceptación se genera un
        compromiso vinculante por el monto acordado. El transportista ejecuta el viaje, registra
        recogida y entrega; Booster persiste evidencia, telemetría (si hay Teltonika) y certifica la
        huella de carbono.
      </p>
      <h3>Tiers de membresía</h3>
      <ul>
        <li>
          <strong>Free</strong>: $0/mes · comisión 12% · acceso al marketplace y certificación ESG.
        </li>
        <li>
          <strong>Standard</strong>: $15.000/mes · comisión 9% · badge verificado, soporte humano.
        </li>
        <li>
          <strong>Pro</strong>: $45.000/mes · comisión 7% · prioridad alta, dashboards.
        </li>
        <li>
          <strong>Premium</strong>: $120.000/mes · comisión 5% · Teltonika incluido, prioridad
          máxima.
        </li>
      </ul>
      <p>
        Al registrarte entras automáticamente al tier <strong>Free</strong>.
      </p>

      <h2>4. Modelo de cobro</h2>
      <p>
        Cuando un viaje queda <strong>entregado</strong>, Booster calcula automáticamente la
        comisión sobre el monto bruto del viaje según el tier, aplica IVA 19% y emite DTE Tipo 33
        (Factura Electrónica) al transportista. El transportista emite DTE Tipo 52 (Guía de
        Despacho) al generador por el monto bruto.
      </p>
      <p>Ejemplo: viaje de $200.000 con tier Free (12%):</p>
      <ul>
        <li>Monto bruto: $200.000</li>
        <li>Comisión Booster: $24.000</li>
        <li>IVA: $4.560</li>
        <li>
          <strong>Factura Booster al carrier:</strong> $28.560
        </li>
        <li>
          <strong>Neto al carrier:</strong> $176.000
        </li>
      </ul>

      <h2>5. Obligaciones del Transportista</h2>
      <ol>
        <li>Ejecutar los viajes aceptados con vehículos, conductores y permisos al día.</li>
        <li>Mantener actualizada su información tributaria y de contacto.</li>
        <li>Reportar incidentes a la brevedad por canales oficiales.</li>
        <li>No usar la plataforma para evadir obligaciones laborales con sus conductores.</li>
        <li>Permitir telemetría cuando aplique (tier Premium con device subsidiado).</li>
        <li>Aceptar el cargo de la comisión dentro de los plazos del DTE.</li>
      </ol>

      <h2>6. Obligaciones de Booster</h2>
      <ol>
        <li>SLA objetivo del 99% mensual (excluyendo mantenimientos comunicados).</li>
        <li>
          Procesar liquidaciones con la metodología publicada, auditablemente y sin alteración
          retroactiva.
        </li>
        <li>Emitir DTE conforme al SII chileno vía proveedor certificado.</li>
        <li>Proteger datos personales conforme a la Ley 19.628.</li>
        <li>Comunicar cambios materiales con 30 días de anticipación.</li>
      </ol>

      <h2>7. Disputas</h2>
      <p>
        Si consideras que una liquidación tiene errores, puedes abrir disputa dentro de los 30 días
        corridos desde la emisión. Booster revisa en máximo 10 días hábiles.
      </p>

      <h2>8. Datos personales</h2>
      <p>
        Aplicable la Política de Privacidad vigente. Booster <strong>no vende</strong> datos a
        terceros. Comparte solo lo estrictamente necesario con proveedores tecnológicos (Google
        Cloud, Twilio, Sovos) bajo confidencialidad.
      </p>

      <h2>9. Modificaciones</h2>
      <p>
        Booster puede modificar estos Términos. Cambios materiales y adversos se notifican con 30
        días de anticipación; puedes dar de baja tu cuenta sin penalidad antes de la entrada en
        vigor.
      </p>

      <h2>10. Ley aplicable</h2>
      <p>
        Estos Términos se rigen por las leyes de Chile. Disputas no resueltas amistosamente se
        someten a tribunales ordinarios de Santiago.
      </p>

      <p className="text-neutral-500 text-xs">
        Versión completa con todas las cláusulas legales: ver{' '}
        <code>docs/legal/terminos-de-servicio-v2.md</code> en el repositorio público de Booster.
      </p>
    </>
  );
}
