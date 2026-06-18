import type { Metadata } from 'next';
import { PageShell } from '../../../components/PageShell.js';

export const metadata: Metadata = {
  title: 'Para generadores de carga — Booster AI',
  description:
    'Publica tus cargas, encuentra transportistas con capacidad disponible y certifica la huella de carbono de cada viaje.',
};

export default function SolucionesGeneradoresPage() {
  return (
    <PageShell
      title="Eres generador de carga"
      intro="Publica tus cargas y encuentra transportistas con capacidad disponible en tu ruta. Certifica la huella de carbono de cada viaje bajo GLEC v3.0 y GHG Protocol, lista para tus reportes ESG."
    />
  );
}
