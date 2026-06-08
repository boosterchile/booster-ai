import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '../../components/PageShell.js';

export const metadata: Metadata = {
  title: 'Soluciones — Booster AI',
  description:
    'Soluciones de Booster AI para transportistas, generadores de carga y stakeholders ESG.',
};

const LINKS = [
  { href: '/soluciones/transportistas', label: 'Para transportistas' },
  { href: '/soluciones/generadores', label: 'Para generadores de carga' },
  { href: '/soluciones/stakeholders-esg', label: 'Para stakeholders ESG' },
];

export default function SolucionesPage() {
  return (
    <PageShell
      title="Soluciones"
      intro="Elige tu rol para ver cómo Booster optimiza tu operación y certifica tu huella de carbono."
    >
      <ul className="space-y-3">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="cursor-pointer font-medium text-primary-700 hover:text-primary-800"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
