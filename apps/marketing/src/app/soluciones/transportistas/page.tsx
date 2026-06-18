import type { Metadata } from 'next';
import { PageShell } from '../../../components/PageShell.js';

export const metadata: Metadata = {
  title: 'Para transportistas — Booster AI',
  description:
    'Recibe ofertas de carga compatibles con tus rutas, monetiza retornos vacíos y reduce kilómetros en vacío.',
};

export default function SolucionesTransportistasPage() {
  return (
    <PageShell
      title="Eres transportista"
      intro="Recibe ofertas de carga compatibles con tus rutas y horarios, monetiza tus retornos vacíos y reduce los kilómetros en vacío de tu flota. Cada viaje suma a un certificado de huella verificable."
    />
  );
}
