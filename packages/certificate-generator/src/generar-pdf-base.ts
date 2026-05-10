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
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  DISCLAIMER_SECUNDARIO_LINEAS,
  formatRouteDataSource,
  formatearNumeroPrincipal,
  muestraDisclaimerSecundario,
  subtituloHeader,
  tamanoTitulo,
  tituloHeader,
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
 */
export async function generarPdfBase(params: ParametrosGenerarPdf): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const colorPrimary = rgb(0.043, 0.376, 0.659); // azul Booster (#0B60A8 aprox)
  const colorMuted = rgb(0.4, 0.4, 0.45);
  const colorBorder = rgb(0.85, 0.85, 0.87);
  const colorEmphasis = rgb(0.05, 0.55, 0.32); // verde para kg CO2e

  // ADR-028: el nivel de certificación determina el título del header
  // y la presencia del disclaimer. Si el campo está ausente (legacy
  // path pre-ADR-028), tratamos como primario para no romper certs
  // viejos.
  const nivelCert = params.metricas.certificationLevel ?? 'primario_verificable';
  const esPrimario = nivelCert === 'primario_verificable';
  const colorBackground = esPrimario ? colorPrimary : rgb(0.55, 0.4, 0.05); // ámbar para secundario

  // ============================================================
  // Header — banda superior con título
  // ============================================================
  page.drawRectangle({
    x: 0,
    y: height - 90,
    width,
    height: 90,
    color: colorBackground,
  });

  page.drawText(tituloHeader(nivelCert), {
    x: 40,
    y: height - 45,
    size: tamanoTitulo(nivelCert),
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText(subtituloHeader(nivelCert), {
    x: 40,
    y: height - 70,
    size: 10,
    font: fontRegular,
    color: rgb(1, 1, 1),
  });

  page.drawText('Booster Chile SpA', {
    x: width - 180,
    y: height - 45,
    size: 12,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  // ============================================================
  // Bloque 1 — Identificación del certificado
  // ============================================================
  let cursorY = height - 130;

  drawLabelValue(
    page,
    'Código de viaje',
    params.viaje.trackingCode,
    40,
    cursorY,
    fontRegular,
    fontBold,
    colorMuted,
  );
  drawLabelValue(
    page,
    'Emitido el',
    formatDateTime(new Date()),
    width / 2,
    cursorY,
    fontRegular,
    fontBold,
    colorMuted,
  );

  cursorY -= 50;

  // ============================================================
  // Bloque 2 — Trayecto
  // ============================================================
  drawSectionTitle(page, 'Trayecto', 40, cursorY, fontBold, colorPrimary);
  cursorY -= 22;

  drawLabelValue(
    page,
    'Origen',
    `${params.viaje.origenDireccion}${params.viaje.origenRegionCode ? ` (Región ${params.viaje.origenRegionCode})` : ''}`,
    40,
    cursorY,
    fontRegular,
    fontBold,
    colorMuted,
  );
  cursorY -= 30;

  drawLabelValue(
    page,
    'Destino',
    `${params.viaje.destinoDireccion}${params.viaje.destinoRegionCode ? ` (Región ${params.viaje.destinoRegionCode})` : ''}`,
    40,
    cursorY,
    fontRegular,
    fontBold,
    colorMuted,
  );
  cursorY -= 30;

  drawLabelValue(
    page,
    'Tipo de carga',
    formatCargoType(params.viaje.cargoTipo),
    40,
    cursorY,
    fontRegular,
    fontBold,
    colorMuted,
  );
  drawLabelValue(
    page,
    'Peso',
    params.viaje.cargoPesoKg !== null
      ? `${params.viaje.cargoPesoKg.toLocaleString('es-CL')} kg`
      : '—',
    width / 2,
    cursorY,
    fontRegular,
    fontBold,
    colorMuted,
  );
  cursorY -= 30;

  if (params.viaje.deliveredAt) {
    drawLabelValue(
      page,
      'Entregado el',
      formatDateTime(params.viaje.deliveredAt),
      40,
      cursorY,
      fontRegular,
      fontBold,
      colorMuted,
    );
    cursorY -= 30;
  }

  cursorY -= 10;

  // ============================================================
  // Bloque 3 — Resultado de carbono (lo importante)
  // ============================================================
  page.drawRectangle({
    x: 30,
    y: cursorY - 130,
    width: width - 60,
    height: 130,
    borderColor: colorBorder,
    borderWidth: 1,
    color: rgb(0.97, 0.99, 0.97),
  });

  drawSectionTitle(
    page,
    'Resultado de huella de carbono',
    40,
    cursorY - 18,
    fontBold,
    colorPrimary,
  );

  const kgWtw = params.metricas.kgco2eWtwActual ?? params.metricas.kgco2eWtwEstimated ?? 0;
  // ADR-028 §3 — si hay factor de incertidumbre, imprimir "X ± Y kg CO2e".
  // El ± se construye como kgWtw × uncertaintyFactor (intervalo simétrico
  // estándar GLEC v3 Annex B). Por ejemplo, 318.7 con factor 0.05 → ±15.9.
  const incertidumbre = params.metricas.uncertaintyFactor;
  const numeroPrincipal = formatearNumeroPrincipal(kgWtw, incertidumbre);
  const numeroPrincipalSize = incertidumbre !== undefined && incertidumbre > 0 ? 22 : 28;

  page.drawText(numeroPrincipal, {
    x: 40,
    y: cursorY - 60,
    size: numeroPrincipalSize,
    font: fontBold,
    color: colorEmphasis,
  });

  page.drawText('Well-to-Wheel (WTW) — combustión + upstream', {
    x: 40,
    y: cursorY - 80,
    size: 9,
    font: fontRegular,
    color: colorMuted,
  });

  // Desglose TTW / WTT a la derecha
  if (params.metricas.kgco2eTtw !== null && params.metricas.kgco2eWtt !== null) {
    page.drawText(
      `TTW: ${params.metricas.kgco2eTtw.toFixed(2)}  ·  WTT: ${params.metricas.kgco2eWtt.toFixed(2)}`,
      {
        x: width - 230,
        y: cursorY - 60,
        size: 10,
        font: fontRegular,
        color: colorMuted,
      },
    );
  }

  if (params.metricas.intensidadGco2ePorTonKm !== null) {
    page.drawText(
      `Intensidad: ${params.metricas.intensidadGco2ePorTonKm.toFixed(2)} gCO2e / t·km`,
      {
        x: width - 230,
        y: cursorY - 80,
        size: 10,
        font: fontRegular,
        color: colorMuted,
      },
    );
  }

  const distanciaKm =
    params.metricas.distanciaKmActual ?? params.metricas.distanciaKmEstimated ?? 0;

  page.drawText(
    `Distancia: ${distanciaKm.toFixed(1)} km  ·  Combustible: ${
      params.metricas.combustibleConsumido !== null
        ? `${params.metricas.combustibleConsumido.toFixed(2)} ${params.metricas.combustibleUnidad ?? ''}`
        : '—'
    }`,
    {
      x: 40,
      y: cursorY - 110,
      size: 10,
      font: fontRegular,
      color: rgb(0.2, 0.2, 0.22),
    },
  );

  cursorY -= 150;

  // ============================================================
  // Bloque 3.5 — Ahorro CO₂e via matching de retorno (ADR-021 §6.4)
  // ============================================================
  // Solo renderizamos si el cálculo se realizó (factorMatchingAplicado
  // != null) Y hubo ahorro real (> 0). Esto evita ruido visual en certs
  // donde el viaje no tuvo medición de backhaul, o donde el retorno fue
  // 100% vacío (peor caso GLEC §6.4.2).
  const factorMatching = params.metricas.factorMatchingAplicado;
  const ahorroBackhaul = params.metricas.ahorroCo2eVsSinMatchingKgco2eWtw;
  if (factorMatching != null && ahorroBackhaul != null && ahorroBackhaul > 0) {
    drawSectionTitle(
      page,
      'Ahorro CO₂e via matching de retorno (GLEC v3.0 §6.4)',
      40,
      cursorY,
      fontBold,
      colorPrimary,
    );
    cursorY -= 22;
    drawLabelValue(
      page,
      'Factor de matching aplicado',
      `${(factorMatching * 100).toFixed(0)}%`,
      40,
      cursorY,
      fontRegular,
      fontBold,
      colorMuted,
    );
    drawLabelValue(
      page,
      'Ahorro vs sin matching',
      `${ahorroBackhaul.toFixed(2)} kg CO2e`,
      width / 2,
      cursorY,
      fontRegular,
      fontBold,
      colorMuted,
    );
    cursorY -= 35;
  }

  // ============================================================
  // Bloque 4 — Metodología (auditoría)
  // ============================================================
  drawSectionTitle(page, 'Metodología', 40, cursorY, fontBold, colorPrimary);
  cursorY -= 22;

  drawLabelValue(
    page,
    'Versión GLEC',
    params.metricas.glecVersion,
    40,
    cursorY,
    fontRegular,
    fontBold,
    colorMuted,
  );
  drawLabelValue(
    page,
    'Modo de precisión',
    formatPrecisionMethod(params.metricas.precisionMethod),
    width / 2,
    cursorY,
    fontRegular,
    fontBold,
    colorMuted,
  );
  cursorY -= 30;

  drawLabelValue(
    page,
    'Factor de emisión usado',
    `${params.metricas.emissionFactorUsado.toFixed(5)} kgCO2e / unidad`,
    40,
    cursorY,
    fontRegular,
    fontBold,
    colorMuted,
  );
  cursorY -= 30;

  drawLabelValue(
    page,
    'Fuente factores',
    params.metricas.fuenteFactores,
    40,
    cursorY,
    fontRegular,
    fontBold,
    colorMuted,
  );
  cursorY -= 30;

  // ADR-028 — Origen del polyline (segunda dimensión de calidad). Solo
  // imprimimos si el campo está presente, para no inventar info en certs
  // viejos pre-ADR-028.
  if (params.metricas.routeDataSource) {
    drawLabelValue(
      page,
      'Origen de la ruta',
      formatRouteDataSource(params.metricas.routeDataSource),
      40,
      cursorY,
      fontRegular,
      fontBold,
      colorMuted,
    );
    if (params.metricas.coveragePct !== undefined) {
      drawLabelValue(
        page,
        'Cobertura telemétrica',
        `${params.metricas.coveragePct.toFixed(1)}%`,
        width / 2,
        cursorY,
        fontRegular,
        fontBold,
        colorMuted,
      );
    }
    cursorY -= 30;
  }

  // ADR-028 — Disclaimer prominente solo en certs secundarios. Es el
  // mecanismo de greenwashing-prevention: el cliente que recibe un cert
  // secundario lee inmediatamente que NO es auditable bajo SBTi/CDP, y
  // que existe path de upgrade vía Teltonika.
  if (muestraDisclaimerSecundario(nivelCert)) {
    cursorY -= 5;
    page.drawRectangle({
      x: 30,
      y: cursorY - 60,
      width: width - 60,
      height: 60,
      borderColor: rgb(0.85, 0.65, 0.1),
      borderWidth: 1,
      color: rgb(0.99, 0.96, 0.86),
    });
    page.drawText('IMPORTANTE — DATOS SECUNDARIOS MODELADOS', {
      x: 40,
      y: cursorY - 18,
      size: 9,
      font: fontBold,
      color: rgb(0.55, 0.4, 0.05),
    });
    let ly = cursorY - 32;
    for (const line of DISCLAIMER_SECUNDARIO_LINEAS) {
      page.drawText(line, {
        x: 40,
        y: ly,
        size: 8,
        font: fontRegular,
        color: rgb(0.3, 0.25, 0.1),
      });
      ly -= 12;
    }
    cursorY -= 70;
  }

  cursorY -= 10;

  // ============================================================
  // Bloque 5 — Partes
  // ============================================================
  drawSectionTitle(page, 'Partes', 40, cursorY, fontBold, colorPrimary);
  cursorY -= 22;

  drawLabelValue(
    page,
    'Generador de carga',
    `${params.empresaShipper.legalName}${params.empresaShipper.rut ? ` (${params.empresaShipper.rut})` : ''}`,
    40,
    cursorY,
    fontRegular,
    fontBold,
    colorMuted,
  );
  cursorY -= 30;

  if (params.transportista?.legalName) {
    drawLabelValue(
      page,
      'Transportista',
      `${params.transportista.legalName}${params.transportista.rut ? ` (${params.transportista.rut})` : ''}`,
      40,
      cursorY,
      fontRegular,
      fontBold,
      colorMuted,
    );
    cursorY -= 30;

    if (params.transportista.vehiclePlate) {
      drawLabelValue(
        page,
        'Vehículo',
        params.transportista.vehiclePlate,
        40,
        cursorY,
        fontRegular,
        fontBold,
        colorMuted,
      );
      cursorY -= 30;
    }
  }

  // ============================================================
  // Footer — verificación
  // ============================================================
  page.drawLine({
    start: { x: 30, y: 80 },
    end: { x: width - 30, y: 80 },
    color: colorBorder,
    thickness: 1,
  });

  page.drawText(
    'Este documento está firmado digitalmente con RSA 4096 / SHA-256 (PKCS#1 v1.5) vía Google Cloud KMS.',
    {
      x: 40,
      y: 60,
      size: 9,
      font: fontRegular,
      color: colorMuted,
    },
  );
  page.drawText(`Verificá la firma en: ${params.verifyUrl}`, {
    x: 40,
    y: 45,
    size: 9,
    font: fontBold,
    color: colorPrimary,
  });
  page.drawText(
    'Documento emitido por Booster Chile SpA. Cualquier alteración invalida la firma.',
    {
      x: 40,
      y: 30,
      size: 8,
      font: fontRegular,
      color: colorMuted,
    },
  );

  // ============================================================
  // Placeholder de firma — listo para embed PAdES
  // ============================================================
  // @signpdf/placeholder-plain v3.x cambió la API: ahora opera sobre el
  // buffer del PDF ya serializado (no el PDFDocument de pdf-lib). Por eso
  // serializamos primero y reescribimos sobre el Buffer resultante.
  // ContactInfo y Reason van en el /Sig dictionary y son visibles en
  // Adobe Reader. Mantenerlos cortos.
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
  return new Uint8Array(pdfWithPlaceholder);
}

// ============================================================
// Helpers de diseño
// ============================================================

type Page = ReturnType<PDFDocument['addPage']>;
type Font = Awaited<ReturnType<PDFDocument['embedFont']>>;
type RGB = ReturnType<typeof rgb>;

function drawLabelValue(
  page: Page,
  label: string,
  value: string,
  x: number,
  y: number,
  fontRegular: Font,
  fontBold: Font,
  colorMuted: RGB,
) {
  page.drawText(label.toUpperCase(), {
    x,
    y: y + 12,
    size: 7,
    font: fontRegular,
    color: colorMuted,
  });
  page.drawText(value, {
    x,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.12),
  });
}

function drawSectionTitle(
  page: Page,
  text: string,
  x: number,
  y: number,
  fontBold: Font,
  colorPrimary: RGB,
) {
  page.drawText(text, {
    x,
    y,
    size: 11,
    font: fontBold,
    color: colorPrimary,
  });
}

function formatDateTime(d: Date): string {
  // Formato: "DD-MM-YYYY HH:mm" en hora Chile.
  return new Intl.DateTimeFormat('es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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
