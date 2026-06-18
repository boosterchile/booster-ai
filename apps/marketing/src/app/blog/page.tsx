import type { Metadata } from 'next';
import { PageShell } from '../../components/PageShell.js';

export const metadata: Metadata = {
  title: 'Blog — Booster AI',
  description:
    'Artículos sobre logística sostenible, huella de carbono y transporte de carga en Chile.',
};

export default function BlogPage() {
  return (
    <PageShell
      title="Blog"
      intro="Ideas sobre logística sostenible, metodología de huella de carbono y el transporte de carga en Chile."
    />
  );
}
