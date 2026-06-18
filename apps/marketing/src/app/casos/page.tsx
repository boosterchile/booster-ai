import type { Metadata } from 'next';
import { PageShell } from '../../components/PageShell.js';

export const metadata: Metadata = {
  title: 'Casos — Booster AI',
  description:
    'Casos de transportistas y generadores de carga que optimizan rutas y certifican su huella con Booster AI.',
};

export default function CasosPage() {
  return (
    <PageShell
      title="Casos"
      intro="Pronto publicaremos casos reales de transportistas y generadores de carga que reducen kilómetros en vacío y certifican su huella con Booster AI."
    />
  );
}
