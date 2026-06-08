import type { Metadata } from 'next';
import { PageShell } from '../../components/PageShell.js';

export const metadata: Metadata = {
  title: 'Contacto — Booster AI',
  description:
    'Contáctanos para sumarte a Booster AI como transportista, generador de carga o stakeholder ESG.',
};

export default function ContactoPage() {
  return (
    <PageShell
      title="Contacto"
      intro="¿Quieres sumarte o tienes preguntas? Escríbenos y te contactamos."
    >
      <a
        href="mailto:soporte@boosterchile.com"
        className="font-semibold text-primary-700 hover:text-primary-800"
      >
        soporte@boosterchile.com
      </a>
    </PageShell>
  );
}
