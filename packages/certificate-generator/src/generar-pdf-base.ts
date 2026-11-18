/**
 * Genera el PDF base del certificado de huella de carbono. El PDF
 * resultante:
 *   - Tiene todo el contenido visual (logo, datos del viaje, métricas).
 *   - Incluye un placeholder de firma vacío (`/Sig` dictionary con
 *     `/Contents <00...>` de tamaño fijo) usando @signpdf/placeholder-plain.
 *   - Está listo para `firmar-pades.ts` que reemplaza el placeholder con
 *     la firma PAdES real sin reflowear el PDF.
 *
 * Por qué placeholder + firma deferred (en vez de generar PDF firmado en
 * un solo paso): la firma necesita el hash del PDF SIN la firma, lo que
 * es imposible si la firma se incluye en el PDF original. El truco PAdES
 * estándar es: reservar bytes vacíos, calcular hash del PDF excluyendo
 * esos bytes (`/ByteRange [a b c d]`), firmar, y reescribir solo los
 * bytes del placeholder. El resto del PDF queda intacto.
 */

import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { PDFDocument, type PDFFont, rgb, setCharacterSpacing } from 'pdf-lib';
import {
  FRASE_CONSOLIDACION,
  TEXTO_METODO_REPARTO,
  validarConsolidacion,
} from './consolidacion.js';
import { type FuentesCert, embeberFuentes } from './fuentes.js';
import { lineaReemplazo, validarVersion } from './reemision.js';
import {
  FRASE_ISO,
  type Presentacion,
  TAMANO_LINEA_METODO,
  TITULO_CERT,
  TITULO_DISCLAIMER,
  declaracionDistancia,
  formatRouteDataSource,
  formatearNumeroPrincipal,
  lineaMetodoCert,
  numeroEsCl,
  presentacionNivel,
  subtituloMetodologia,
  textoDisclaimer,
  textoNotaMetodo,
} from './render-helpers.js';
import type {
  DatosEmpresaCertificado,
  DatosMetricasCertificado,
  DatosTransportistaCertificado,
  DatosViajeCertificado,
} from './tipos.js';

export interface ParametrosGenerarPdf {
  viaje: DatosViajeCertificado;
  metricas: DatosMetricasCertificado;
  empresaShipper: DatosEmpresaCertificado;
  transportista?: DatosTransportistaCertificado;
  /**
   * URL pública del endpoint /verify (incluida en el PDF como QR/link
   * para que cualquier lector externo valide la firma online).
   */
  verifyUrl: string;
  /**
   * Tamaño del placeholder de firma en bytes. Default 16384 — suficiente
   * para PKCS7 con cert RSA 4096 (~3-4 KB) + slack para timestamps RFC3161
   * en el futuro. Si el PKCS7 real excede este tamaño, signpdf falla con
   * "signature exceeds placeholder size".
   */
  placeholderBytes?: number;
}

const DEFAULT_PLACEHOLDER_BYTES = 16384;

/**
 * Genera el PDF y devuelve los bytes con el placeholder embebido.
 * Layout v2 (HC-004, ux.md): fila superior · regla · título + sello ·
 * subtítulo · badge · fechas · Resultados · disclaimer · Metodología · resto.
 */
export async function generarPdfBase(params: ParametrosGenerarPdf): Promise<Uint8Array> {
  return (await generarPdfConCajas(params)).bytes;
}

/**
 * Igual que `generarPdfBase`, pero además devuelve el bbox de cada elemento
 * no textual (sello, badge, cajas, reglas y líneas). Los tests de márgenes lo
 * usan junto con las posiciones de texto de pdfjs.
 */
export async function generarPdfConCajas(
  params: ParametrosGenerarPdf,
): Promise<{ bytes: Uint8Array; cajas: CajaDibujada[]; textos: TextoDibujado[] }> {
  const pdfDoc = await PDFDocument.create();
  const f = await embeberFuentes(pdfDoc);
  const m = params.metricas;
  const pres = presentacionNivel(m);
  const registro: Registro = { cajas: [], textos: [], zona: 'contenido' };
  const c = new Cursor(pdfDoc, registro);

  // 1. Fila superior: marca a la izquierda; código y versión a la derecha.
  const ver = validarVersion(params.viaje.version);
  c.texto('Booster', MX, c.y - 16, 16, f.bold, AZUL);
  c.derecha('Código de viaje', c.y - 10, 9, f.regular, GRIS);
  c.derecha(params.viaje.trackingCode, c.y - 24, 11, f.bold, TEXTO);
  c.derecha(
    `Versión ${ver.numero}${ver.reemplazaA ? ` · reemplaza a v${ver.reemplazaA}` : ''}`,
    c.y - 37,
    9,
    f.regular,
    GRIS,
  );
  c.y -= 48;
  // 2. Regla azul (igual para todos los niveles: el nivel no va en color de fondo).
  dibujarLinea(c.page, {
    start: { x: MX, y: c.y },
    end: { x: MX2, y: c.y },
    thickness: 3,
    color: AZUL,
  });
  c.y -= 32;

  // 3–4. Título y sello ESTIMADO en la misma línea (baja si no cabe).
  c.texto(TITULO_CERT, MX, c.y, 20, f.bold, AZUL);
  if (pres.estimado) {
    const finTitulo = MX + f.bold.widthOfTextAtSize(TITULO_CERT, 20) + 14;
    const anchoSello = anchoConTracking('ESTIMADO', f.bold, 9.5, 1.5) + 16;
    const cabe = finTitulo + anchoSello <= MX2;
    if (!cabe) {
      c.y -= 28;
    }
    const xSello = cabe ? finTitulo : MX;
    dibujarSello(c.page, xSello, c.y, anchoSello, f.bold);
  }
  c.y -= 20;
  // 5. Subtítulo: metodología (versión de la emisión) + frase ISO.
  c.texto(subtituloMetodologia(m.glecVersion), MX, c.y, 9, f.regular, GRIS);
  c.y -= 13;
  c.texto(FRASE_ISO, MX, c.y, 9, f.regular, TEXTO);
  c.y -= 12;

  // 6. Badge de calidad de datos.
  const colores = COLORES_BADGE[pres.presentacion];
  const ancho = f.semibold.widthOfTextAtSize(pres.badge, 9.5) + 20;
  rectRedondeado(c.page, MX, c.y - 12 - 18, ancho, 18, 9, {
    color: colores.fondo,
    borderColor: colores.borde,
    borderWidth: 0.75,
  });
  c.texto(pres.badge, MX + 10, c.y - 12 - 12.5, 9.5, f.semibold, colores.texto);
  c.y -= 12 + 18 + 22;

  // 7. Fechas (3 columnas). Null → «—», sin caer a otro dato (T3 trae las reales).
  const col = (MX2 - MX) / 3;
  const fechas: Array<[string, string]> = [
    ['Fecha del viaje', params.viaje.deliveredAt ? formatDate(params.viaje.deliveredAt) : '—'],
    ['Salida · Llegada', '—'],
    ['Emitido el', formatDateTime(new Date())],
  ];
  fechas.forEach(([label, valor], i) => {
    c.texto(label, MX + i * col, c.y, 8.5, f.regular, GRIS);
    c.texto(valor, MX + i * col, c.y - 15, 10.5, f.semibold, TEXTO);
  });
  c.y -= 40;

  // 7b. Certificado reemitido: a qué versión reemplaza, de cuándo y por qué.
  const reemplazo = lineaReemplazo(ver, formatDate);
  if (reemplazo) {
    // Una sola línea (spec §8-2): si no cabe, falla en vez de cortarla.
    if (partir(reemplazo, f.regular, 9, MX2 - MX).length > 1) {
      throw new Error(`la línea de reemplazo no cabe en una línea: «${reemplazo}»`);
    }
    c.texto(reemplazo, MX, c.y, 9, f.regular, TEXTO);
    c.y -= 24;
  }

  // 8. Resultados.
  const kgWtw = m.kgco2eWtwActual ?? m.kgco2eWtwEstimated ?? 0;
  const consolidacion = validarConsolidacion(m.consolidacion, kgWtw);
  const num = formatearNumeroPrincipal(kgWtw, m.uncertaintyFactor);
  const topCaja = c.y;
  c.y -= 22;
  c.texto('Emisiones totales WTW', MX + 16, c.y, 9, f.regular, GRIS);
  c.y -= 26;
  c.texto(num.valor, MX + 16, c.y, 22, f.bold, TEXTO);
  c.texto(
    num.detalle,
    MX + 16 + f.bold.widthOfTextAtSize(num.valor, 22) + 6,
    c.y,
    10.5,
    f.semibold,
    GRIS,
  );
  c.y -= 16;
  c.texto('Well-to-Wheel (WTW) — combustión + upstream', MX + 16, c.y, 9, f.regular, GRIS);
  const detalles: string[] = [];
  if (m.kgco2eTtw !== null && m.kgco2eWtt !== null) {
    detalles.push(`TTW: ${numeroEsCl(m.kgco2eTtw)} · WTT: ${numeroEsCl(m.kgco2eWtt)} kg CO\u2082e`);
  }
  if (m.intensidadGco2ePorTonKm !== null) {
    detalles.push(`Intensidad: ${numeroEsCl(m.intensidadGco2ePorTonKm)} g CO\u2082e / t·km`);
  }
  const distanciaKm = m.distanciaKmActual ?? m.distanciaKmEstimated ?? 0;
  // Invariante F0-0 §7: la distancia va cualificada por la cobertura medida.
  // Una carga consolidada publica su distancia directa: la que entró al
  // reparto, no lo que el camión recorrió. No lleva cobertura: no es medida.
  const distancia = consolidacion
    ? `Distancia directa: ${numeroEsCl(distanciaKm, 1)} km`
    : `Distancia: ${numeroEsCl(distanciaKm, 1)} km (${declaracionDistancia(m.coveragePct)})`;
  detalles.push(
    `${distancia} · Combustible: ${
      m.combustibleConsumido !== null
        ? `${numeroEsCl(m.combustibleConsumido)} ${m.combustibleUnidad ?? ''}`
        : '—'
    }`,
  );
  for (const d of detalles) {
    for (const l of partir(d, f.regular, 9.5, MX2 - MX - 32)) {
      c.y -= 14;
      c.texto(l, MX + 16, c.y, 9.5, f.regular, TEXTO);
    }
  }
  c.y -= 16;
  dibujarRect(c.page, {
    x: MX,
    y: c.y,
    width: MX2 - MX,
    height: topCaja - c.y,
    borderColor: hex('#D9DEE3'),
    borderWidth: 1,
  });
  c.y -= 16;

  // 9. Disclaimer: inmediatamente después de Resultados y entero (no se parte).
  if (pres.estimado) {
    const lineas = partir(
      textoDisclaimer(m.fuenteFactores, m.glecVersion),
      f.regular,
      9,
      MX2 - MX - 28,
    );
    const alto = 20 + 14 + lineas.length * 13;
    c.asegurar(alto);
    dibujarRect(c.page, {
      x: MX,
      y: c.y - alto,
      width: MX2 - MX,
      height: alto,
      color: hex('#FEF3E2'),
    });
    dibujarRect(c.page, { x: MX, y: c.y - alto, width: 3, height: alto, color: AMBAR });
    c.texto(TITULO_DISCLAIMER, MX + 14, c.y - 20, 9.5, f.bold, TEXTO);
    lineas.forEach((l, i) => c.texto(l, MX + 14, c.y - 34 - i * 13, 9, f.regular, TEXTO));
    c.y -= alto + 20;
  }
  // ADR-091 §2: nota de método en párrafo normal, en el lugar del disclaimer.
  if (pres.presentacion === 'medido_teltonika') {
    const lineas = partir(
      textoNotaMetodo(m.fuenteFactores, m.glecVersion, m.consolidacion !== undefined),
      f.regular,
      9,
      MX2 - MX,
    );
    c.asegurar(lineas.length * 13 + 8);
    lineas.forEach((l, i) => c.texto(l, MX, c.y - 10 - i * 13, 9, f.regular, GRIS));
    c.y -= lineas.length * 13 + 20;
  }

  // Metodología (auditoría).
  c.seccion('Metodología', f);
  c.asegurar(16);
  c.texto(FRASE_ISO, MX, c.y, 9.5, f.regular, TEXTO);
  c.y -= 30;
  // HC-003 (ux.md:18): la versión GLEC es la metodología; los factores citan su propia versión.
  c.par(
    'Metodología GLEC',
    m.glecVersion,
    'Modo de precisión',
    formatPrecisionMethod(m.precisionMethod),
    f,
  );
  c.par(
    'Factor de emisión usado',
    `${numeroEsCl(m.emissionFactorUsado)} kg CO\u2082e / unidad`,
    null,
    null,
    f,
  );
  c.par('Fuente de factores', m.fuenteFactores, null, null, f);
  // ADR-028 — origen del polyline; solo si el campo está presente.
  if (m.routeDataSource) {
    c.par(
      'Origen de la ruta',
      formatRouteDataSource(m.routeDataSource),
      m.coveragePct !== undefined ? 'Cobertura telemétrica' : null,
      m.coveragePct !== undefined ? `${numeroEsCl(m.coveragePct, 1)}%` : null,
      f,
    );
    // ADR-077 §4 — línea de método con vocabulario cerrado.
    const lineaMetodo = lineaMetodoCert(m);
    if (lineaMetodo !== null) {
      c.par('Método', lineaMetodo, null, null, f, TAMANO_LINEA_METODO);
    }
  }

  // Carga consolidada (ADR-089): con qué método se repartió la huella de la
  // ruta, qué parte es de esta carga y cuánto fue el total.
  if (consolidacion) {
    c.seccion('Carga consolidada', f);
    const lineas = partir(FRASE_CONSOLIDACION, f.regular, 9.5, MX2 - MX);
    // La frase y sus dos filas van juntas: no se parten entre dos páginas.
    c.asegurar(lineas.length * 13 + 17 + 60);
    for (const l of lineas) {
      c.texto(l, MX, c.y, 9.5, f.regular, TEXTO);
      c.y -= 13;
    }
    c.y -= 17;
    c.par(
      'Método de reparto',
      TEXTO_METODO_REPARTO,
      'Versión del método',
      consolidacion.versionMetodo,
      f,
    );
    c.par(
      'Participación de esta carga',
      `${numeroEsCl(consolidacion.participacionPct)} %`,
      'Huella total de la ruta',
      `${numeroEsCl(consolidacion.kgco2eWtwRuta)} kg CO\u2082e`,
      f,
    );
  }

  // Trayecto.
  c.seccion('Trayecto', f);
  const region = (r: string | null) => (r ? ` (Región ${r})` : '');
  c.par(
    'Origen',
    `${params.viaje.origenDireccion}${region(params.viaje.origenRegionCode)}`,
    null,
    null,
    f,
  );
  c.par(
    'Destino',
    `${params.viaje.destinoDireccion}${region(params.viaje.destinoRegionCode)}`,
    null,
    null,
    f,
  );
  c.par(
    'Tipo de carga',
    formatCargoType(params.viaje.cargoTipo),
    'Peso',
    params.viaje.cargoPesoKg !== null
      ? `${params.viaje.cargoPesoKg.toLocaleString('es-CL')} kg`
      : '—',
    f,
  );
  if (params.viaje.deliveredAt) {
    c.par('Entregado el', formatDateTime(params.viaje.deliveredAt), null, null, f);
  }

  // Ahorro por matching de retorno (ADR-021 §6.4): solo con cálculo y ahorro > 0.
  const factorMatching = m.factorMatchingAplicado;
  const ahorroBackhaul = m.ahorroCo2eVsSinMatchingKgco2eWtw;
  if (factorMatching != null && ahorroBackhaul != null && ahorroBackhaul > 0) {
    c.seccion('Ahorro CO\u2082e vía matching de retorno (GLEC v3.0 §6.4)', f);
    c.par(
      'Factor de matching aplicado',
      `${(factorMatching * 100).toFixed(0)}%`,
      'Ahorro vs sin matching',
      `${numeroEsCl(ahorroBackhaul)} kg CO\u2082e`,
      f,
    );
  }

  // Partes.
  c.seccion('Partes', f);
  const rut = (r: string | null) => (r ? ` (${r})` : '');
  c.par(
    'Generador de carga',
    `${params.empresaShipper.legalName}${rut(params.empresaShipper.rut)}`,
    null,
    null,
    f,
  );
  const t = params.transportista;
  if (t?.legalName) {
    c.par('Transportista', `${t.legalName}${rut(t.rut)}`, null, null, f);
    if (t.vehiclePlate) {
      c.par('Vehículo', t.vehiclePlate, null, null, f);
    }
  }

  // Verificación.
  c.asegurar(50);
  c.y -= 6;
  c.texto(
    'Este documento está firmado digitalmente con RSA 4096 / SHA-256 (PKCS#1 v1.5) vía Google Cloud KMS.',
    MX,
    c.y,
    8.5,
    f.regular,
    GRIS,
  );
  const lineasUrl = partir(`Verifica la firma en: ${params.verifyUrl}`, f.semibold, 8.5, MX2 - MX);
  lineasUrl.forEach((l, i) => c.texto(l, MX, c.y - 13 - i * 11, 8.5, f.semibold, AZUL));
  c.texto(
    'Documento emitido por Booster Chile SpA. Cualquier alteración invalida la firma.',
    MX,
    c.y - 15 - lineasUrl.length * 11,
    8,
    f.regular,
    GRIS,
  );

  // ============================================================
  // Placeholder de firma — listo para embed PAdES
  // ============================================================
  // @signpdf/placeholder-plain v3.x cambió la API: ahora opera sobre el
  // buffer del PDF ya serializado (no el PDFDocument de pdf-lib). Por eso
  // serializamos primero y reescribimos sobre el Buffer resultante.
  // ContactInfo y Reason van en el /Sig dictionary y son visibles en
  // Adobe Reader. Mantenerlos cortos.
  registro.zona = 'pie';
  dibujarPies(pdfDoc, f, params.viaje, pres.estimado);
  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  // subFilter explícito: el default de plainAddPlaceholder es
  // SUBFILTER_ADOBE_PKCS7_DETACHED (legacy Adobe), pero PAdES-B-B exige
  // ETSI.CAdES.detached. Adobe Reader acepta ambos; validadores PAdES
  // estrictos (eIDAS, auditores ESG) rechazan el legacy.
  const pdfWithPlaceholder = plainAddPlaceholder({
    pdfBuffer: Buffer.from(pdfBytes),
    reason: 'Certificación de huella de carbono GLEC v3.0',
    contactInfo: 'sustentabilidad@boosterchile.com',
    name: 'Booster Chile SpA',
    location: 'Santiago, Chile',
    signatureLength: params.placeholderBytes ?? DEFAULT_PLACEHOLDER_BYTES,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
  });
  return {
    bytes: new Uint8Array(pdfWithPlaceholder),
    cajas: registro.cajas,
    textos: registro.textos,
  };
}

// ============================================================
// Helpers de diseño
// ============================================================

type Page = ReturnType<PDFDocument['addPage']>;
type RGB = ReturnType<typeof rgb>;

const A4: [number, number] = [595.28, 841.89];
const MX = 48;
const MX2 = A4[0] - 48;
const TOPE = A4[1] - 40;
/** Bajo esta y empieza la zona del pie (vN · Página X de Y). */
const PISO = 56;

/**
 * Área útil de la hoja (pt). Laterales de 48 y superior de 40 (ux.md
 * §Estructura); el inferior de 20 deja el pie («BOO-X · vN», baseline 24) a
 * más de 7 mm del borde. Ningún texto ni caja puede salir de aquí.
 */
export const AREA_UTIL = { x0: MX, x1: MX2, y0: 20, y1: TOPE } as const;

/**
 * El contenido (todo menos el pie) no baja de aquí: la línea del pie está en
 * y=36 y se dejan 8 pt libres sobre ella.
 */
export const TOPE_PIE = 44;

/** Texto dibujado: bbox calculado de los mismos x/y/size/fuente de drawText. */
export interface TextoDibujado {
  pagina: number;
  texto: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pie: boolean;
}

interface Registro {
  cajas: CajaDibujada[];
  textos: TextoDibujado[];
  zona: 'contenido' | 'pie';
}

/**
 * Todo lo que se dibuja pasa por dibujarTexto/dibujarRect/dibujarLinea/
 * rectRedondeado, que anotan el bbox con los MISMOS argumentos que van a
 * pdf-lib (no hay una llamada de registro aparte que pueda desalinearse).
 */
const paginasRegistradas = new WeakMap<Page, { pagina: number; registro: Registro }>();
function registrarPagina(page: Page, pagina: number, registro: Registro): void {
  paginasRegistradas.set(page, { pagina, registro });
}
function marcarPie(page: Page): void {
  const r = paginasRegistradas.get(page);
  if (r) {
    r.registro.zona = 'pie';
  }
}
function anotarCaja(page: Page, x: number, y: number, w: number, h: number): void {
  const r = paginasRegistradas.get(page);
  r?.registro.cajas.push({ pagina: r.pagina, x, y, w, h, pie: r.registro.zona === 'pie' });
}
function dibujarTexto(
  page: Page,
  t: string,
  o: { x: number; y: number; size: number; font: PDFFont; color: RGB },
): void {
  page.drawText(t, o);
  const r = paginasRegistradas.get(page);
  const alto = o.font.heightAtSize(o.size);
  const descenso = alto - o.font.heightAtSize(o.size, { descender: false });
  r?.registro.textos.push({
    pagina: r.pagina,
    texto: t,
    x: o.x,
    y: o.y - descenso,
    // Sin el tracking del sello (+1,5 pt/carácter): su caja ya lo contiene.
    w: o.font.widthOfTextAtSize(t, o.size),
    h: alto,
    pie: r.registro.zona === 'pie',
  });
}
function dibujarRect(
  page: Page,
  o: {
    x: number;
    y: number;
    width: number;
    height: number;
    color?: RGB;
    borderColor?: RGB;
    borderWidth?: number;
  },
): void {
  page.drawRectangle(o);
  anotarCaja(page, o.x, o.y, o.width, o.height);
}
function dibujarLinea(
  page: Page,
  o: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    thickness: number;
    color: RGB;
  },
): void {
  page.drawLine(o);
  const t = o.thickness / 2;
  anotarCaja(
    page,
    Math.min(o.start.x, o.end.x),
    Math.min(o.start.y, o.end.y) - t,
    Math.abs(o.end.x - o.start.x),
    Math.abs(o.end.y - o.start.y) + o.thickness,
  );
}

/** Bbox de un elemento no textual dibujado en la página `pagina` (0-based). */
export interface CajaDibujada {
  pagina: number;
  x: number;
  y: number;
  w: number;
  h: number;
  pie: boolean;
}

function hex(h: string): RGB {
  const n = Number.parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const AZUL = hex('#0B3D5C');
const TEXTO = hex('#1F2933');
const GRIS = hex('#52606D');
const AMBAR = hex('#B45309');
/** Colores del badge por presentación (ADR-091): ámbar solo en Estimado. */
const COLORES_BADGE: Record<Presentacion, { fondo: RGB; borde: RGB; texto: RGB }> = {
  primario: { fondo: hex('#E6F4EA'), borde: hex('#86C79B'), texto: hex('#14532D') },
  medido_teltonika: { fondo: hex('#E8F1F8'), borde: hex('#8FB4D1'), texto: hex('#0B3D5C') },
  estimado: { fondo: hex('#FEF3E2'), borde: hex('#F0B46B'), texto: hex('#7C3A0A') },
};

/** Cursor vertical con salto de página cuando un bloque no cabe. */
class Cursor {
  page: Page;
  y = TOPE;
  pagina = 0;
  constructor(
    private readonly doc: PDFDocument,
    private readonly registro: Registro,
  ) {
    this.page = doc.addPage(A4);
    registrarPagina(this.page, 0, registro);
  }
  /** Título de sección aún no dibujado: viaja con el primer bloque que lo sigue. */
  private tituloPendiente: { t: string; f: FuentesCert } | null = null;
  asegurar(alto: number): void {
    const titulo = this.tituloPendiente;
    if (this.y - alto - (titulo ? 30 : 0) < PISO) {
      this.page = this.doc.addPage(A4);
      this.pagina += 1;
      registrarPagina(this.page, this.pagina, this.registro);
      this.y = TOPE;
    }
    if (titulo) {
      this.tituloPendiente = null;
      // El alto del título (11 pt) va bajo el tope, no sobre él.
      this.y = Math.min(this.y, TOPE - 11);
      this.texto(titulo.t, MX, this.y, 11, titulo.f.bold, AZUL);
      this.y -= 30;
    }
  }
  texto(t: string, x: number, y: number, size: number, font: PDFFont, color: RGB): void {
    dibujarTexto(this.page, t, { x, y, size, font, color });
  }
  derecha(t: string, y: number, size: number, font: PDFFont, color: RGB): void {
    this.texto(t, MX2 - font.widthOfTextAtSize(t, size), y, size, font, color);
  }
  seccion(t: string, f: FuentesCert): void {
    // El título no queda huérfano: se dibuja en el próximo `asegurar`, junto
    // con el bloque que lo sigue (QA #873: «Trayecto» quedaba solo al pie de
    // la página 1 cuando el Origen largo saltaba a la 2).
    this.tituloPendiente = { t, f };
  }
  /**
   * Una fila con uno o dos pares label/valor (8,5 gris / valor semibold). Los
   * valores se parten al ancho de su columna (QA #873: direcciones largas y
   * tipos de carga extremos se salían o pisaban la segunda columna).
   */
  par(
    l1: string,
    v1: string,
    l2: string | null,
    v2: string | null,
    f: FuentesCert,
    size = 10.5,
  ): void {
    const dos = l2 !== null && v2 !== null;
    const xCol2 = A4[0] / 2;
    const lineas1 = partir(v1, f.semibold, size, dos ? xCol2 - MX - 12 : MX2 - MX);
    const lineas2 = dos ? partir(v2, f.semibold, size, MX2 - xCol2) : [];
    const interlinea = size * 1.3;
    const extra = (Math.max(lineas1.length, lineas2.length) - 1) * interlinea;
    this.asegurar(30 + extra);
    // Tras un salto de página la etiqueta (12 pt sobre el valor) no puede pasar el tope.
    this.y = Math.min(this.y, TOPE - 21);
    this.texto(l1, MX, this.y + 12, 8.5, f.regular, GRIS);
    lineas1.forEach((l, i) => this.texto(l, MX, this.y - i * interlinea, size, f.semibold, TEXTO));
    if (dos) {
      this.texto(l2, xCol2, this.y + 12, 8.5, f.regular, GRIS);
      lineas2.forEach((l, i) =>
        this.texto(l, xCol2, this.y - i * interlinea, size, f.semibold, TEXTO),
      );
    }
    this.y -= 30 + extra;
  }
}

function anchoConTracking(t: string, font: PDFFont, size: number, tracking: number): number {
  return font.widthOfTextAtSize(t, size) + tracking * (t.length - 1);
}

/** Sello ESTIMADO: recuadro ámbar sin relleno, MAYÚSCULAS con tracking +1,5. */
function dibujarSello(page: Page, x: number, yBase: number, ancho: number, bold: PDFFont): void {
  rectRedondeado(page, x, yBase - 5, ancho, 20, 3, { borderColor: AMBAR, borderWidth: 1.5 });
  page.pushOperators(setCharacterSpacing(1.5));
  dibujarTexto(page, 'ESTIMADO', { x: x + 8, y: yBase + 1, size: 9.5, font: bold, color: AMBAR });
  page.pushOperators(setCharacterSpacing(0));
}

/** Rectángulo redondeado vía path SVG (pdf-lib no tiene radio en drawRectangle). */
function rectRedondeado(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  opts: { color?: RGB; borderColor?: RGB; borderWidth?: number },
): void {
  const path = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  page.drawSvgPath(path, { x, y: y + h, ...opts });
  anotarCaja(page, x, y, w, h);
}

/**
 * Parte un texto en líneas que caben en `ancho` pt. Una palabra que no cabe
 * sola (token sin espacios) se corta por caracteres.
 */
function partir(t: string, font: PDFFont, size: number, ancho: number): string[] {
  const lineas: string[] = [];
  let actual = '';
  // QA #873 v2: un \n o \r\n en datos de usuario (direcciones desde formularios
  // o el bot) pdf-lib lo dibuja como línea extra que el layout no cuenta.
  const palabras = t
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .flatMap((p) => cortarPalabra(p, font, size, ancho));
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (font.widthOfTextAtSize(prueba, size) > ancho && actual) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = prueba;
    }
  }
  if (actual) {
    lineas.push(actual);
  }
  return lineas;
}

function cortarPalabra(p: string, font: PDFFont, size: number, ancho: number): string[] {
  if (font.widthOfTextAtSize(p, size) <= ancho) {
    return [p];
  }
  // Ancho acumulado por carácter (O(n)); medir el trozo entero en cada paso
  // era O(n²) y un token de 300 caracteres llevaba el PDF a ~1,5 s.
  const trozos: string[] = [];
  let actual = '';
  let anchoActual = 0;
  for (const ch of p) {
    const w = font.widthOfTextAtSize(ch, size);
    if (actual && anchoActual + w > ancho) {
      trozos.push(actual);
      actual = ch;
      anchoActual = w;
    } else {
      actual += ch;
      anchoActual += w;
    }
  }
  if (actual) {
    trozos.push(actual);
  }
  return trozos;
}

/** Pie de todas las páginas: «BOO-X · vN[ · Estimado]» y «Página X de Y». */
function dibujarPies(
  doc: PDFDocument,
  f: FuentesCert,
  viaje: DatosViajeCertificado,
  estimado: boolean,
): void {
  const paginas = doc.getPages();
  for (const p of paginas) {
    marcarPie(p);
  }
  const izq = `${viaje.trackingCode} · v${viaje.version?.numero ?? 1}`;
  paginas.forEach((p, i) => {
    dibujarLinea(p, {
      start: { x: MX, y: 36 },
      end: { x: MX2, y: 36 },
      thickness: 0.5,
      color: hex('#D9DEE3'),
    });
    dibujarTexto(p, izq, { x: MX, y: 24, size: 8, font: f.regular, color: GRIS });
    if (estimado) {
      dibujarTexto(p, ' · Estimado', {
        x: MX + f.regular.widthOfTextAtSize(izq, 8),
        y: 24,
        size: 8,
        font: f.bold,
        color: AMBAR,
      });
    }
    const der = `Página ${i + 1} de ${paginas.length}`;
    dibujarTexto(p, der, {
      x: MX2 - f.regular.widthOfTextAtSize(der, 8),
      y: 24,
      size: 8,
      font: f.regular,
      color: GRIS,
    });
  });
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Santiago',
  }).format(d);
}

function formatDateTime(d: Date): string {
  // Formato: "DD-MM-YYYY HH:mm" en hora Chile.
  return new Intl.DateTimeFormat('es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Santiago',
  }).format(d);
}

function formatCargoType(s: string): string {
  // "carga_seca" → "Carga seca"
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function formatPrecisionMethod(m: string): string {
  switch (m) {
    case 'exacto_canbus':
      return 'Exacto (CAN-BUS)';
    case 'modelado':
      return 'Modelado';
    case 'por_defecto':
      return 'Por defecto';
    default:
      return m;
  }
}
