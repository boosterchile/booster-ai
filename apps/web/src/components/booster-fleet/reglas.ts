import {
  CONFIGURACION_BOOSTER_FLEET,
  type PanelBoosterFleet,
  type SenalCombustible,
} from '@booster-ai/shared-schemas';

/**
 * Reglas de presentación de Booster Fleet (`.specs/booster-fleet-rediseno`).
 * Puras: no calculan señales, solo deciden cómo se muestran las que entrega
 * el API. La interfaz no dice «robo»: la señal `posible_robo` se muestra
 * como una desviación que hay que analizar.
 */

export type Tono = 'primero' | 'sin_lectura' | 'atencion' | 'en_orden' | 'neutro';

type Combustible = PanelBoosterFleet['combustible'];
type Documental = PanelBoosterFleet['documental'];
export type VehiculoFlota = Combustible['vehiculos'][number];
export type EstadoDocumento = Documental['vehiculos'][number]['estado'];
export type EstadoMantencion = PanelBoosterFleet['mantenciones']['items'][number]['estado'];

const ZONA = 'America/Santiago';

export const TONO_DE_SENAL: Record<SenalCombustible, Tono> = {
  posible_robo: 'primero',
  sin_telemetria: 'sin_lectura',
  sin_movimiento: 'sin_lectura',
  sin_sensor: 'sin_lectura',
  falta_capacidad: 'sin_lectura',
  dato_no_confiable: 'sin_lectura',
  consumo_alto: 'atencion',
  en_orden: 'en_orden',
};

export const ETIQUETA_SENAL: Record<SenalCombustible, string> = {
  posible_robo: 'Desviación',
  sin_telemetria: 'Sin telemetría',
  sin_movimiento: 'Sin movimiento',
  sin_sensor: 'Sin sensor',
  falta_capacidad: 'Falta capacidad',
  dato_no_confiable: 'Dato no confiable',
  consumo_alto: 'Consumo alto',
  en_orden: 'En orden',
};

const DESCRIPCION_SENAL: Record<SenalCombustible, string> = {
  posible_robo: 'Desviación de combustible por analizar',
  sin_telemetria: 'No tiene equipo Teltonika',
  sin_movimiento: 'Ningún trayecto en 7 días',
  sin_sensor: 'Los trayectos no traen combustible',
  falta_capacidad: 'Falta la capacidad del estanque',
  dato_no_confiable: 'La lectura no da un L/100 km confiable',
  consumo_alto: 'Sobre la mediana de la flota · puede ser la vía',
  en_orden: 'Dentro del rango de la flota',
};

/** La señal dicha dentro de la frase de estado, después de la patente. */
const SENAL_EN_FRASE: Record<SenalCombustible, string> = {
  posible_robo: 'una desviación de combustible por analizar',
  sin_telemetria: 'no tiene telemetría',
  sin_movimiento: 'no se movió en 7 días',
  sin_sensor: 'no tiene sensor de combustible',
  falta_capacidad: 'falta la capacidad del estanque',
  dato_no_confiable: 'su dato de combustible no es confiable',
  consumo_alto: 'consume más que el resto de la flota',
  en_orden: 'está en orden',
};

export const TITULO_TONO: Record<Tono, string> = {
  primero: 'Analizar primero',
  sin_lectura: 'Sin lectura',
  atencion: 'Atención',
  en_orden: 'En orden',
  neutro: 'Programada',
};

const ORDEN_TONOS: readonly Tono[] = ['primero', 'sin_lectura', 'atencion', 'en_orden'];

/** Grupos por tono, en orden de gravedad. Dentro de cada uno se respeta el orden del API. */
export function agruparPorTono(
  vehiculos: readonly VehiculoFlota[],
): Array<{ tono: Tono; vehiculos: VehiculoFlota[] }> {
  return ORDEN_TONOS.map((tono) => ({
    tono,
    vehiculos: vehiculos.filter((v) => TONO_DE_SENAL[v.senal] === tono),
  })).filter((grupo) => grupo.vehiculos.length > 0);
}

/**
 * La primera oración de la pantalla: cuántos camiones piden revisión y por
 * cuál partir. `foco` es la segunda mitad, la que nombra por dónde empezar.
 */
export function fraseEstado(combustible: Combustible): { inicio: string; foco: string | null } {
  const total = combustible.vehiculos.length;
  const conAlerta = combustible.vehiculos.filter((v) => v.senal !== 'en_orden');
  if (total === 0) {
    return { inicio: 'Todavía no hay vehículos en la flota.', foco: null };
  }
  if (conAlerta.length === 0) {
    return {
      inicio:
        total === 1
          ? 'Tu camión está en orden esta semana.'
          : `Los ${total} camiones están en orden esta semana.`,
      foco: null,
    };
  }
  const inicio =
    conAlerta.length === 1
      ? '1 camión pide revisión.'
      : `${conAlerta.length} camiones piden revisión.`;
  const desviaciones = conAlerta.filter((v) => v.senal === 'posible_robo');
  if (desviaciones.length > 1) {
    return { inicio, foco: `Parte por las ${desviaciones.length} desviaciones de combustible.` };
  }
  const primero = desviaciones[0] ?? conAlerta[0];
  if (!primero) {
    return { inicio, foco: null };
  }
  return { inicio, foco: `Parte por ${primero.patente}: ${SENAL_EN_FRASE[primero.senal]}.` };
}

/**
 * Mediana de L/100 km para la marca de la barra. Solo de lectura: no
 * reemplaza la señal `consumo_alto`, que viene del API. Null con menos de
 * dos camiones comparables.
 */
export function medianaLectura(vehiculos: readonly VehiculoFlota[]): number | null {
  const ratios = vehiculos
    .filter(
      (v) =>
        v.litros_por_100_km != null &&
        v.km != null &&
        v.km >= CONFIGURACION_BOOSTER_FLEET.kmMinimosCompararConsumo,
    )
    .map((v) => v.litros_por_100_km ?? 0)
    .sort((a, b) => a - b);
  if (ratios.length < 2) {
    return null;
  }
  const medio = Math.floor(ratios.length / 2);
  if (ratios.length % 2 === 1) {
    return ratios[medio] ?? null;
  }
  return ((ratios[medio - 1] ?? 0) + (ratios[medio] ?? 0)) / 2;
}

export type Destino =
  | { to: '/app/trayectos'; search: { vehiculo: string; detalle?: string } }
  | { to: '/app/vehiculos/$id'; params: { id: string } };

/** La acción de cada señal y a dónde lleva. `en_orden` no tiene acción. */
export function accionDe(vehiculo: VehiculoFlota): { etiqueta: string; destino: Destino } | null {
  const ficha: Destino = { to: '/app/vehiculos/$id', params: { id: vehiculo.vehiculo_id } };
  const trayectos: Destino = { to: '/app/trayectos', search: { vehiculo: vehiculo.vehiculo_id } };
  switch (vehiculo.senal) {
    case 'posible_robo':
      return {
        etiqueta: 'Analizar trayecto',
        destino: vehiculo.desviacion
          ? {
              to: '/app/trayectos',
              search: {
                vehiculo: vehiculo.vehiculo_id,
                detalle: vehiculo.desviacion.trayecto_id,
              },
            }
          : trayectos,
      };
    case 'sin_telemetria':
    case 'sin_movimiento':
      return { etiqueta: 'Ir al vehículo', destino: ficha };
    case 'sin_sensor':
      return { etiqueta: 'Revisar sensor', destino: ficha };
    case 'falta_capacidad':
      return { etiqueta: 'Cargar capacidad', destino: ficha };
    case 'dato_no_confiable':
      return { etiqueta: 'Ver trayectos', destino: trayectos };
    case 'consumo_alto':
      return { etiqueta: 'Comparar trayectos', destino: trayectos };
    case 'en_orden':
      return null;
  }
}

function partes(fecha: Date, opciones: Intl.DateTimeFormatOptions): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const parte of new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA,
    ...opciones,
  }).formatToParts(fecha)) {
    salida[parte.type] = parte.value.replace('.', '');
  }
  return salida;
}

/** «vie 13 nov, 03:12», en hora de Santiago. Null si el instante no es válido. */
export function formatoFechaHora(iso: string | null): string | null {
  if (iso == null) {
    return null;
  }
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }
  const p = partes(fecha, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

/**
 * Cuándo se leyó el combustible, para completar «Combustible leído …»:
 * «a las 12:30» si fue hoy en Santiago, «el mar 17 nov, 18:02» si fue otro
 * día. Null si el instante no es válido.
 */
export function momentoDeLectura(iso: string | null, ahora: Date = new Date()): string | null {
  if (iso == null) {
    return null;
  }
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }
  const dia = (d: Date) => {
    const p = partes(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
    return `${p.year}-${p.month}-${p.day}`;
  };
  if (dia(fecha) !== dia(ahora)) {
    return `el ${formatoFechaHora(iso)}`;
  }
  const p = partes(fecha, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `a las ${p.hour}:${p.minute}`;
}

/** «13 nov» para una fecha de calendario `AAAA-MM-DD` o un instante ISO. */
export function formatoFecha(valor: string | null): string | null {
  if (valor == null) {
    return null;
  }
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  const fecha = soloFecha ? new Date(`${valor}T12:00:00.000Z`) : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }
  const p = partes(fecha, { day: 'numeric', month: 'short' });
  return `${p.day} ${p.month}`;
}

const NUMERO = new Intl.NumberFormat('es-CL', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** «1 camión», «3 camiones»: el número con su sustantivo en singular o plural. */
export function contar(cantidad: number, uno: string, varios: string): string {
  return `${cantidad} ${cantidad === 1 ? uno : varios}`;
}

/** Un decimal con coma. */
export function formatoNumero(valor: number): string {
  return NUMERO.format(valor);
}

export function formatoCoordenadas(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null) {
    return null;
  }
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/**
 * La línea bajo la etiqueta. Una desviación dice siempre sus litros, su
 * fecha y hora, y su lugar; si falta alguno, lo dice en vez de omitirlo.
 */
export function descripcionDe(vehiculo: VehiculoFlota): string {
  const desviacion = vehiculo.desviacion;
  if (vehiculo.senal !== 'posible_robo' || !desviacion) {
    return DESCRIPCION_SENAL[vehiculo.senal];
  }
  const litros =
    desviacion.litros != null ? `−${formatoNumero(desviacion.litros)} L` : 'litros sin dato';
  const cuando = formatoFechaHora(desviacion.hasta ?? desviacion.desde) ?? 'hora sin dato';
  const donde = formatoCoordenadas(desviacion.lat, desviacion.lon) ?? 'lugar sin dato';
  const mas = desviacion.total > 1 ? ` · ${desviacion.total} en la semana` : '';
  const tipo = desviacion.tipo === 'hormiga' ? 'Gradual · ' : '';
  return `${tipo}${litros} · ${cuando} · ${donde}${mas}`;
}

const NOMBRE_DOCUMENTO: Record<string, string> = {
  revision_tecnica: 'Revisión técnica',
  permiso_circulacion: 'Permiso de circulación',
  soap: 'SOAP',
  padron: 'Padrón',
  seguro_carga: 'Seguro de carga',
  poliza_responsabilidad: 'Póliza de responsabilidad civil',
  certificado_emisiones: 'Certificado de emisiones',
  licencia_conducir: 'Licencia de conducir',
  curso_b6: 'Curso B6',
  certificado_antecedentes: 'Certificado de antecedentes',
  examen_psicotecnico: 'Examen psicotécnico',
  hoja_vida_conductor: 'Hoja de vida',
  certificado_salud: 'Certificado de salud',
  otro: 'Otro',
};

const ORDEN_DOCUMENTO: Record<EstadoDocumento, number> = {
  vencido: 0,
  faltante: 1,
  sin_fecha: 2,
  sin_archivo: 3,
  por_vencer: 4,
  vigente: 5,
};

export const TONO_DOCUMENTO: Record<EstadoDocumento, Tono> = {
  vencido: 'primero',
  faltante: 'primero',
  sin_fecha: 'sin_lectura',
  sin_archivo: 'sin_lectura',
  por_vencer: 'atencion',
  vigente: 'en_orden',
};

const TEXTO_DOCUMENTO: Record<EstadoDocumento, string> = {
  vencido: 'Vencido',
  faltante: 'Falta el documento',
  sin_fecha: 'Sin fecha de vencimiento',
  sin_archivo: 'Falta el archivo',
  por_vencer: 'Por vencer',
  vigente: 'Vigente',
};

export interface HallazgoDocumental {
  clave: string;
  de: 'vehiculo' | 'conductor';
  id: string;
  quien: string;
  documento: string;
  estado: EstadoDocumento;
  texto: string;
}

/**
 * Documentos pendientes de vehículos y conductores en una sola lista:
 * primero lo vencido y lo faltante, después lo que no tiene fecha o archivo,
 * al final lo que está por vencer. No incluye el RUT del conductor.
 */
export function hallazgosDocumentales(documental: Documental): HallazgoDocumental[] {
  const salida: HallazgoDocumental[] = [];
  const agregar = (
    de: HallazgoDocumental['de'],
    id: string,
    quien: string,
    documentos: Documental['vehiculos'][number]['documentos'],
  ) => {
    for (const doc of documentos) {
      if (doc.estado === 'vigente') {
        continue;
      }
      const fecha = formatoFecha(doc.fecha_vencimiento);
      const conFecha = doc.estado === 'vencido' || doc.estado === 'por_vencer';
      salida.push({
        clave: `${de}:${id}:${doc.tipo}`,
        de,
        id,
        quien,
        documento: NOMBRE_DOCUMENTO[doc.tipo] ?? doc.tipo,
        estado: doc.estado,
        texto:
          conFecha && fecha
            ? `${TEXTO_DOCUMENTO[doc.estado]} · ${fecha}`
            : TEXTO_DOCUMENTO[doc.estado],
      });
    }
  };
  for (const fila of documental.vehiculos) {
    agregar('vehiculo', fila.vehiculo_id, fila.patente, fila.documentos);
  }
  for (const fila of documental.conductores) {
    agregar('conductor', fila.conductor_id, fila.nombre, fila.documentos);
  }
  return salida
    .map((hallazgo, indice) => ({ hallazgo, indice }))
    .sort(
      (a, b) =>
        ORDEN_DOCUMENTO[a.hallazgo.estado] - ORDEN_DOCUMENTO[b.hallazgo.estado] ||
        a.indice - b.indice,
    )
    .map((par) => par.hallazgo);
}

export const TONO_MANTENCION: Record<EstadoMantencion, Tono> = {
  vencida: 'primero',
  proxima: 'atencion',
  programada: 'neutro',
  realizada: 'en_orden',
};

export const ETIQUETA_MANTENCION: Record<EstadoMantencion, string> = {
  vencida: 'Vencida',
  proxima: 'Próxima',
  programada: 'Programada',
  realizada: 'Realizada',
};
