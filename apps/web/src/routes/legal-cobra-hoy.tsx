import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

/**
 * /legal/cobra-hoy — Adendum público de pronto pago (ADR-029 v1 / ADR-032).
 *
 * Documento marco: docs/legal/adendum-cobra-hoy-v1.md.
 *
 * Pública (sin auth) para que el Transportista pueda revisar términos
 * antes de aceptar una solicitud. El acto de aceptación ocurre en el
 * modal de `CobraHoyButton`, no acá.
 */
export function LegalCobraHoyRoute() {
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
            <h1 className="font-semibold text-neutral-900 text-lg">Adendum — Booster Cobra Hoy</h1>
            <p className="text-neutral-500 text-xs">
              Versión 1 · Vigente desde 2026-05-10 · Marco:{' '}
              <Link to="/legal/terminos" className="underline">
                Términos de Servicio v2 §4.3
              </Link>
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <article className="prose prose-neutral mt-2 max-w-none rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <AdendumContent />
        </article>
      </main>
    </div>
  );
}

function AdendumContent() {
  return (
    <>
      <h2>1. Naturaleza del servicio</h2>
      <p>
        Booster ofrece a los Transportistas, en forma <strong>opcional</strong>, anticipar el cobro
        del monto neto de un viaje entregado sin esperar el plazo natural de pago del Generador de
        carga ("Shipper"). El servicio se llama <strong>"Booster Cobra Hoy"</strong> o{' '}
        <strong>"pronto pago"</strong>.
      </p>
      <p>
        El servicio opera en modo <strong>partner</strong>: Booster facilita la solicitud y registra
        el adelanto, pero el dinero proviene de un partner financiero externo regulado que asume el
        riesgo de crédito frente al Shipper. Booster <strong>no</strong> es institución financiera
        ni requiere registro CMF mientras se mantenga en partner-mode.
      </p>

      <h2>2. Quién puede solicitar</h2>
      <p>Transportistas activos que tengan:</p>
      <ol>
        <li>Términos de Servicio v2 y este Adendum aceptados.</li>
        <li>
          Al menos un viaje <strong>entregado</strong> con liquidación calculada.
        </li>
        <li>Un Shipper con crédito aprobado por Booster + Partner.</li>
      </ol>

      <h2>3. Cómo se calcula la tarifa</h2>
      <p>
        Tarifa sobre el <strong>monto neto del viaje</strong> según el plazo declarado del Shipper:
      </p>
      <table>
        <thead>
          <tr>
            <th>Plazo Shipper</th>
            <th>Tarifa</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>30 días</td>
            <td>1,50%</td>
          </tr>
          <tr>
            <td>45 días</td>
            <td>2,20%</td>
          </tr>
          <tr>
            <td>60 días</td>
            <td>3,00%</td>
          </tr>
          <tr>
            <td>90 días</td>
            <td>4,50%</td>
          </tr>
        </tbody>
      </table>
      <p>
        Plazos intermedios se interpolan linealmente. Plazos &gt; 90 días aplican techo dinámico
        (4,5% + 0,5% × cada 15 días, máximo absoluto 8,0%). Redondeo HALF_UP a entero CLP.
        Metodología versionada <code>factoring-v1.0-cl-2026.06</code>, congelada por solicitud.
      </p>
      <p>
        <em>Ejemplo</em>: viaje neto $176.000, plazo 30 días → tarifa $2.640 →{' '}
        <strong>recibes $173.360 hoy</strong>.
      </p>

      <h2>4. Criterios del Shipper</h2>
      <ol>
        <li>
          Score Equifax CL ≥ 700 → límite estándar · 550–699 → límite reducido · &lt; 550 → rechazo.
        </li>
        <li>Antigüedad mínima 24 meses.</li>
        <li>Sin cuentas impagas vigentes.</li>
        <li>Concentración: suma de adelantos vivos del Shipper ≤ su límite.</li>
        <li>Decisión vigente 90 días. Sin score automático → revisión manual ≤ 2 días hábiles.</li>
      </ol>

      <h2>5. Flujo operativo</h2>
      <ol>
        <li>
          Click <strong>"Cobra hoy"</strong> en la pantalla del viaje entregado.
        </li>
        <li>La plataforma muestra el desglose en tiempo real.</li>
        <li>
          Confirmas. La solicitud queda en estado <code>solicitado</code>.
        </li>
        <li>
          El Partner valida y transfiere a la cuenta registrada (<code>desembolsado</code>).
        </li>
        <li>
          Booster cobra al Shipper en su fecha (<code>cobrado_a_shipper</code>). Tú no esperas.
        </li>
      </ol>

      <h2>6. Cesión de derechos</h2>
      <p>
        Al confirmar, cedes al Partner los derechos de cobro sobre ese viaje específico (Art. 1901 y
        siguientes del Código Civil chileno), a título oneroso (recibes el monto adelantado) y{' '}
        <strong>sin recurso</strong> contra el Transportista en condiciones normales. Excepciones:
        §7.
      </p>

      <h2>7. Excepciones con recurso</h2>
      <p>El adelanto pasa a tener recurso contra el Transportista si:</p>
      <ol>
        <li>El viaje se cancela o no se entrega por causa imputable al Transportista.</li>
        <li>Hay fraude, falsedad u omisiones materiales en la solicitud.</li>
        <li>El Shipper disputa válidamente la entrega y no se resuelve en 30 días corridos.</li>
      </ol>

      <h2>8. Tratamiento tributario</h2>
      <ul>
        <li>
          El monto adelantado <strong>no es ingreso adicional</strong>: sustituye temporalmente el
          pago del Shipper.
        </li>
        <li>
          La tarifa de pronto pago es operación financiera <strong>exenta de IVA</strong> (Art. 12-E
          DL 825).
        </li>
        <li>El Partner emite el certificado tributario correspondiente.</li>
        <li>
          La comisión Booster sobre el viaje (DTE Tipo 33) <strong>no varía</strong>.
        </li>
      </ul>

      <h2>9. Privacidad</h2>
      <p>
        Para underwriting Booster consulta el score Equifax CL del Shipper bajo Ley 19.628 / Ley
        19.812. El Transportista solicitante no accede a estos datos — sólo conoce el resultado
        agregado.
      </p>

      <h2>10. Modificaciones</h2>
      <p>
        Cambios <strong>adversos</strong> al Transportista se comunican con 30 días de anticipación.
        Cambios neutros o favorables entran en vigor al publicarse. La metodología versionada
        capturada en cada solicitud no varía retroactivamente.
      </p>

      <p className="text-neutral-500 text-xs">
        Versión completa del Adendum con todas las cláusulas legales: ver{' '}
        <code>docs/legal/adendum-cobra-hoy-v1.md</code> en el repositorio público de Booster.
        Consultas: <a href="mailto:soporte@boosterchile.com">soporte@boosterchile.com</a>.
      </p>
    </>
  );
}
