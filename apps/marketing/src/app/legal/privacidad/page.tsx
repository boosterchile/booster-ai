import type { Metadata } from 'next';
import { PageShell } from '../../../components/PageShell.js';

export const metadata: Metadata = {
  title: 'Política de privacidad — Booster AI',
  description: 'Cómo Booster AI trata tus datos personales conforme a la Ley 19.628 de Chile.',
};

export default function PrivacidadPage() {
  return (
    <PageShell
      title="Política de privacidad"
      intro="Tratamos tus datos personales conforme a la Ley 19.628 de Chile. La versión legal definitiva se publicará antes de la apertura del registro."
    />
  );
}
