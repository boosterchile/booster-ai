import { StatChip } from './piezas.js';

export function PipelineCounts({
  buscando,
  asignadas,
  enCamino,
}: {
  buscando: number;
  asignadas: number;
  enCamino: number;
}) {
  return (
    <div className="grid grid-cols-3 divide-x divide-neutral-200 rounded-md border border-neutral-200">
      <StatChip label="Buscando transp." value={String(buscando)} tono="warning" />
      <StatChip label="Asignadas" value={String(asignadas)} />
      <StatChip label="En camino" value={String(enCamino)} tono="info" />
    </div>
  );
}
