import type { Metadata } from 'next';
import { PageShell } from '../../components/PageShell.js';

export const metadata: Metadata = {
  title: 'Sobre Booster — Booster AI',
  description:
    'Booster AI es un marketplace B2B de logística sostenible en Chile, con foco en certificación de huella de carbono.',
};

export default function SobrePage() {
  return (
    <PageShell
      title="Sobre Booster"
      intro="Somos un marketplace B2B de logística sostenible que conecta generadores de carga con transportistas, optimiza retornos vacíos y certifica la huella de carbono bajo estándares internacionales."
    />
  );
}
