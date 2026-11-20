import { ZONA_INICIO } from '../inicio-transportista/modelo.js';

function ymd(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_INICIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}

function hora(fecha: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA_INICIO,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(fecha);
}

function diaSiguiente(ahora: Date): string {
  const hoy = ymd(ahora);
  const [anio, mes, dia] = hoy.split('-').map((parte) => Number(parte));
  const siguiente = new Date(Date.UTC(anio ?? 2026, (mes ?? 1) - 1, (dia ?? 1) + 1, 15, 0, 0));
  return ymd(siguiente);
}

export function partesCuando(iso: string | null, ahora: Date): { dia: string; hora: string } {
  if (!iso) {
    return { dia: 'Sin hora', hora: '—' };
  }
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) {
    return { dia: 'Sin hora', hora: '—' };
  }
  const hhmm = hora(instante);
  const dia = ymd(instante);
  if (dia === ymd(ahora)) {
    return { dia: 'Hoy', hora: hhmm };
  }
  if (dia === diaSiguiente(ahora)) {
    return { dia: 'Mañana', hora: hhmm };
  }
  const corto = new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA_INICIO,
    weekday: 'short',
    day: 'numeric',
  })
    .format(instante)
    .replace(/\./g, '');
  const limpio = corto.charAt(0).toUpperCase() + corto.slice(1);
  return { dia: limpio, hora: hhmm };
}

export function mismoMes(iso: string, ahora: Date): boolean {
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) {
    return false;
  }
  return ymd(instante).slice(0, 7) === ymd(ahora).slice(0, 7);
}

export function dentroDeDias(iso: string, ahora: Date, dias: number): boolean {
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) {
    return false;
  }
  const delta = ahora.getTime() - instante.getTime();
  return delta >= 0 && delta <= dias * 24 * 60 * 60_000;
}
