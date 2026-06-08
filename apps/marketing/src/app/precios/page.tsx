import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Precios — Booster AI',
  description:
    'Planes de Booster AI para transportistas y generadores de carga. Comienza gratis; sin tarjeta para el plan Free.',
};

const TIERS = [
  {
    name: 'Free',
    price: '$0',
    audience: 'Transportistas y generadores',
    features: ['Recibir y publicar cargas', 'Tracking básico', 'Certificado de huella estándar'],
  },
  {
    name: 'Pro',
    price: 'UF 2–5 / mes',
    audience: 'Operación con volumen',
    features: [
      'Matching prioritario',
      'Certificados premium por vehículo',
      'Reportes mensuales ESG',
    ],
  },
  {
    name: 'Enterprise',
    price: 'A convenir',
    audience: 'Flotas y corporativos',
    features: [
      'Acceso API e integración TMS',
      'Estándares custom (GRI/SASB/CDP)',
      'SLA y soporte dedicado',
    ],
  },
];

export default function PreciosPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="font-bold text-4xl text-neutral-900 tracking-tight">Precios</h1>
      <p className="mt-3 text-lg text-neutral-600">
        Comienza gratis. El plan Free no requiere tarjeta. La contratación de planes pagos se
        coordina al activar tu cuenta.
      </p>
      <div className="mt-10 grid gap-6 sm:grid-cols-3">
        {TIERS.map((t) => (
          <div key={t.name} className="rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
            <h2 className="font-semibold text-lg text-neutral-900">{t.name}</h2>
            <p className="mt-1 font-bold text-2xl text-neutral-900">{t.price}</p>
            <p className="mt-1 text-neutral-500 text-sm">{t.audience}</p>
            <ul className="mt-4 space-y-2 text-neutral-600 text-sm">
              {t.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Link
        href="/signup"
        className="mt-10 inline-block cursor-pointer rounded-md bg-primary-600 px-5 py-3 font-medium text-sm text-white transition hover:bg-primary-700"
      >
        Solicitar acceso
      </Link>
    </main>
  );
}
