import { Link } from '@tanstack/react-router';
import { AlertCircle } from 'lucide-react';
import { useConsentTermsV2 } from '../hooks/use-consent-terms-v2.js';

/**
 * Banner persistente que invita al carrier a aceptar T&Cs v2 (ADR-031 §4).
 *
 * Se muestra cuando:
 *   - Usuario logueado en una empresa transportista
 *   - `carrier_memberships.consent_terms_v2_aceptado_en` IS NULL
 *
 * Se oculta:
 *   - Si la empresa activa NO es carrier (backend devuelve accepted=true
 *     con reason=not_a_carrier)
 *   - Si ya aceptó
 *   - Mientras la query está cargando (evita flash visual)
 *   - Sin empresa activa (no hay carrier_memberships que evaluar)
 *
 * Diseñado para ir dentro de `Layout` justo bajo el header.
 */
export function ConsentTermsBanner() {
  const { data, isLoading } = useConsentTermsV2();

  if (isLoading || !data) {
    return null;
  }
  if (data.accepted) {
    return null;
  }
  if (data.reason && data.reason !== 'pending') {
    return null;
  }

  return (
    <output className="block border-amber-200 border-b bg-amber-50 px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-6xl items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
        <div className="flex-1 text-sm">
          <p className="font-medium text-amber-900">
            Necesitamos tu aceptación de Términos de Servicio v2
          </p>
          <p className="mt-0.5 text-amber-800">
            Para liquidar tus viajes (cálculo de comisión + emisión de DTE) necesitamos que aceptes
            los nuevos Términos de Servicio.
          </p>
          <Link
            to="/legal/terminos"
            className="mt-2 inline-flex items-center gap-1 font-medium text-amber-900 text-sm underline-offset-2 transition hover:underline"
          >
            Revisar y aceptar →
          </Link>
        </div>
      </div>
    </output>
  );
}
