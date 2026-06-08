import type { Metadata } from 'next';
import { PageShell } from '../../../components/PageShell.js';

export const metadata: Metadata = {
  title: 'Términos y condiciones — Booster AI',
  description: 'Términos y condiciones de uso de la plataforma Booster AI.',
};

export default function TerminosPage() {
  return (
    <PageShell
      title="Términos y condiciones"
      intro="Estos términos regulan el uso de la plataforma Booster AI. La versión legal definitiva se publicará antes de la apertura del registro."
    />
  );
}
