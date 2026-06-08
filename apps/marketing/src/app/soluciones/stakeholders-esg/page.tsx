import type { Metadata } from 'next';
import { PageShell } from '../../../components/PageShell.js';

export const metadata: Metadata = {
  title: 'Para stakeholders ESG — Booster AI',
  description:
    'Mandantes corporativos, auditores y reguladores: accede a métricas de huella de tu cadena de suministro con consentimiento explícito y trazable.',
};

export default function SolucionesStakeholdersPage() {
  return (
    <PageShell
      title="Eres mandante corporativo o auditor"
      intro="Accede a dashboards de huella de carbono de tu cadena de suministro con consentimiento explícito y trazable. Exporta reportes GLEC, GHG, GRI, SASB y CDP."
    />
  );
}
