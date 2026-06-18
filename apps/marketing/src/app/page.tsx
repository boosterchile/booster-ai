import type { Metadata } from 'next';
import Link from 'next/link';
import { Hero } from '../components/Hero.js';

export const metadata: Metadata = {
  title: 'Booster AI — Logística sostenible B2B en Chile',
  description:
    'Conecta tu carga con transportistas, optimiza retornos vacíos y certifica tu huella de carbono bajo GLEC v3.0 y GHG Protocol.',
};

const SEGMENTS = [
  {
    href: '/soluciones/transportistas',
    title: 'Eres transportista',
    desc: 'Recibe ofertas de carga y monetiza tus retornos vacíos.',
  },
  {
    href: '/soluciones/generadores',
    title: 'Eres generador de carga',
    desc: 'Publica tus cargas y certifica la huella de cada viaje.',
  },
  {
    href: '/soluciones/stakeholders-esg',
    title: 'Stakeholder ESG',
    desc: 'Accede a métricas de huella de tu cadena de suministro.',
  },
];

export default function HomePage() {
  return (
    <main>
      <Hero />
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid gap-6 sm:grid-cols-3">
          {SEGMENTS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="block cursor-pointer rounded-lg border border-neutral-200 bg-white p-6 shadow-xs transition hover:border-primary-300 hover:shadow-sm"
            >
              <h2 className="font-semibold text-neutral-900 text-sm">{s.title}</h2>
              <p className="mt-1 text-neutral-600 text-sm">{s.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
