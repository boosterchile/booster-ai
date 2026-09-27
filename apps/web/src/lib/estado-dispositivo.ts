/**
 * Estado operativo del dispositivo, compartido por la lista de vehículos y el
 * hub del detalle (`vehiculo-hub.tsx`). La ventana de «conectado» (30 minutos)
 * se define solo aquí.
 */
export const CONECTADO_HASTA_S = 30 * 60;

export type EstadoDispositivo = 'sin_dispositivo' | 'conectado' | 'sin_senal';

export type EstadoDispositivoLista = EstadoDispositivo | 'pendiente';

export type EstadoVehiculoLista = 'activo' | 'mantenimiento' | 'retirado';

export type FiltroVehiculos =
  | 'todos'
  | 'activos'
  | 'mantencion'
  | 'retirados'
  | 'sin_dispositivo'
  | 'sin_senal';

export function estadoDispositivo(input: {
  teltonikaImei: string | null;
  timestampDevice: string | null;
  ahoraMs?: number;
}): EstadoDispositivo {
  const imei = input.teltonikaImei?.trim() ?? '';
  if (imei.length === 0) {
    return 'sin_dispositivo';
  }
  if (input.timestampDevice == null || input.timestampDevice.trim().length === 0) {
    return 'sin_senal';
  }
  const ts = Date.parse(input.timestampDevice);
  if (Number.isNaN(ts)) {
    return 'sin_senal';
  }
  const ahora = input.ahoraMs ?? Date.now();
  const segundos = Math.max(0, Math.floor((ahora - ts) / 1000));
  if (segundos < CONECTADO_HASTA_S) {
    return 'conectado';
  }
  return 'sin_senal';
}

export function etiquetaDispositivo(estado: EstadoDispositivo): string {
  switch (estado) {
    case 'conectado':
      return 'Conectado';
    case 'sin_senal':
      return 'Sin señal';
    case 'sin_dispositivo':
      return 'Sin dispositivo';
  }
}

export interface VehiculoParaFiltro {
  status: EstadoVehiculoLista;
  dispositivo: EstadoDispositivoLista;
}

export function coincideFiltro(filtro: FiltroVehiculos, item: VehiculoParaFiltro): boolean {
  switch (filtro) {
    case 'todos':
      return true;
    case 'activos':
      return item.status === 'activo';
    case 'mantencion':
      return item.status === 'mantenimiento';
    case 'retirados':
      return item.status === 'retirado';
    case 'sin_dispositivo':
      return item.dispositivo === 'sin_dispositivo';
    case 'sin_senal':
      return item.dispositivo === 'sin_senal';
  }
}

export function contarFiltros(items: VehiculoParaFiltro[]): Record<FiltroVehiculos, number> {
  const cuentas: Record<FiltroVehiculos, number> = {
    todos: items.length,
    activos: 0,
    mantencion: 0,
    retirados: 0,
    sin_dispositivo: 0,
    sin_senal: 0,
  };
  for (const item of items) {
    if (item.status === 'activo') {
      cuentas.activos += 1;
    }
    if (item.status === 'mantenimiento') {
      cuentas.mantencion += 1;
    }
    if (item.status === 'retirado') {
      cuentas.retirados += 1;
    }
    if (item.dispositivo === 'sin_dispositivo') {
      cuentas.sin_dispositivo += 1;
    }
    if (item.dispositivo === 'sin_senal') {
      cuentas.sin_senal += 1;
    }
  }
  return cuentas;
}

/** Búsqueda de operador: patente con o sin separadores, marca, modelo o tipo. */
export function coincideBusqueda(consulta: string, campos: string[]): boolean {
  const q = consulta.trim().toLowerCase();
  if (q.length === 0) {
    return true;
  }
  const texto = campos.join(' ').toLowerCase();
  if (texto.includes(q)) {
    return true;
  }
  const compacto = (valor: string) => valor.toLowerCase().replace(/[^a-z0-9]/g, '');
  const qCompacto = compacto(q);
  if (qCompacto.length === 0) {
    return true;
  }
  return compacto(texto).includes(qCompacto);
}
