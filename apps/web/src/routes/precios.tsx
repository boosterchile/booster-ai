import { serviciosPublicosSchema } from '@booster-ai/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import { Building2, Leaf, Loader2, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { getApiUrl } from '../lib/api-url.js';

/**
 * /precios — página pública de precios (T10-29, ADR-079 §4).
 *
 * Lee `GET /public/precios` (la sección `servicios` de la configuración
 * comercial publicada): un cambio que el platform-admin publica se ve aquí
 * en ≤ 60 s, sin deploy. Las comisiones no se publican (decisión del PO del
 * 2026-10-08): el generador las ve en la app antes de publicar cada carga.
 *
 * 404 (modelo v3 aún no vigente), respuesta fuera de contrato o error de
 * red → aviso de "precios en actualización"; nunca valores inventados.
 */
const respuestaSchema = z.object({
  version: z.number().int(),
  vigente_desde: z.string(),
  servicios: serviciosPublicosSchema,
});

type PreciosPublicos = z.infer<typeof respuestaSchema>;

async function fetchPrecios(): Promise<PreciosPublicos | null> {
  try {
    const res = await fetch(`${getApiUrl()}/public/precios`);
    if (!res.ok) {
      return null;
    }
    const parsed = respuestaSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const uf = (n: number) => `${n.toLocaleString('es-CL', { maximumFractionDigits: 4 })} UF`;

function textoCamionesExentos(n: number): string | null {
  if (n <= 0) {
    return null;
  }
  return n === 1
    ? 'Tu primer camión no paga suscripción.'
    : `Tus primeros ${n} camiones no pagan suscripción.`;
}

function Plan(props: {
  icono: ReactNode;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold text-lg text-neutral-900">
        {props.icono}
        {props.titulo}
      </h2>
      <div className="mt-3 space-y-2 text-neutral-700 text-sm">{props.children}</div>
    </section>
  );
}

function Precio(props: { testId: string; valor: string; unidad: string }) {
  return (
    <p>
      <span data-testid={props.testId} className="font-semibold text-2xl text-neutral-900">
        {props.valor}
      </span>{' '}
      <span className="text-neutral-600">{props.unidad}</span>
    </p>
  );
}

export function PreciosRoute() {
  const q = useQuery({
    queryKey: ['public-precios'],
    queryFn: fetchPrecios,
    staleTime: 60_000,
  });

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white pt-safe">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <a href="/" className="font-semibold text-primary-700">
            Booster
          </a>
          <h1 className="mt-2 font-semibold text-2xl text-neutral-900">Precios</h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {q.isLoading ? (
          <p className="flex items-center gap-2 text-neutral-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando precios…
          </p>
        ) : q.data ? (
          <Precios datos={q.data} />
        ) : (
          <p className="rounded-lg border border-neutral-200 bg-white p-6 text-neutral-700">
            Estamos actualizando nuestros precios. Vuelve a revisar esta página en unos días.
          </p>
        )}
      </main>
    </div>
  );
}

function Precios({ datos }: { datos: PreciosPublicos }) {
  const s = datos.servicios;
  const exentos = textoCamionesExentos(s.camiones_sin_cobro_por_transportista);
  const referenciaHuella = s.huella_carbono.precio_referencia_uf;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <Plan
          icono={<Building2 className="h-5 w-5 text-primary-600" aria-hidden />}
          titulo="Generadores de carga"
        >
          <Precio
            testId="precio-generador"
            valor={uf(s.suscripcion_generador_uf_empresa_mes)}
            unidad="por empresa al mes"
          />
          <p>
            La comisión por viaje se informa en la plataforma antes de publicar cada carga, junto
            con el total a pagar.
          </p>
        </Plan>

        <Plan
          icono={<Truck className="h-5 w-5 text-primary-600" aria-hidden />}
          titulo="Transportistas"
        >
          <Precio
            testId="precio-transportista"
            valor={uf(s.suscripcion_transportista_uf_camion_mes)}
            unidad="por camión al mes"
          />
          <p>
            Con gestión de flota:{' '}
            <span data-testid="precio-gestion-flota" className="font-semibold">
              {uf(s.suscripcion_transportista_gestion_flota_uf_camion_mes)}
            </span>{' '}
            por camión al mes.
          </p>
          {exentos && <p>{exentos}</p>}
          <p>Recibes íntegro el precio acordado por cada viaje.</p>
        </Plan>

        <Plan
          icono={<Leaf className="h-5 w-5 text-primary-600" aria-hidden />}
          titulo="Huella de carbono"
        >
          <p>
            Se cotiza por proyecto
            {referenciaHuella !== undefined && `, desde ${uf(referenciaHuella)}`}. Medición y
            certificados según GLEC v3.0.
          </p>
        </Plan>
      </div>

      <p className="mt-6 text-neutral-500 text-xs">
        Precios en UF, netos de IVA; el IVA se suma al facturar. La UF se convierte a pesos con el
        valor del día de emisión de la factura. Versión {datos.version} · vigente desde{' '}
        {new Date(datos.vigente_desde).toLocaleDateString('es-CL')}.
      </p>
    </>
  );
}
