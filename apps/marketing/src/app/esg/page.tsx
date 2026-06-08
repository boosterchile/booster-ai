import type { Metadata } from 'next';
import { PageShell } from '../../components/PageShell.js';

export const metadata: Metadata = {
  title: 'Metodología ESG — Booster AI',
  description:
    'Cómo Booster AI calcula la huella de carbono bajo GLEC v3.0, GHG Protocol e ISO 14064, con factores well-to-wheel.',
};

export default function EsgPage() {
  return (
    <PageShell
      title="Metodología ESG"
      intro="Calculamos la huella de carbono de cada viaje bajo GLEC v3.0, GHG Protocol e ISO 14064, con factores well-to-wheel y certificados verificables. Los reportes se exportan en los formatos GRI, SASB y CDP que tu organización ya usa."
    />
  );
}
