/**
 * Genera el PDF base de una Carta de Porte conforme a Ley 18.290 Art. 174.
 *
 * El PDF incluye los campos obligatorios:
 *   - Folio + fecha
 *   - Datos del porteador, cargador, consignatario, conductor (nombre,
 *     RUT, dirección, contacto)
 *   - Origen + destino
 *   - Características de la carga (naturaleza, cantidad, peso, embalaje)
 *   - Vehículo (patente, tipo)
 *   - Espacio para firma del receptor (capturada off-PDF, persistida
 *     por separado como `firma_receptor`)
 *
 * Igual que certificate-generator, dejamos un placeholder PAdES para
 * firma deferred. El placeholder se reemplaza por `firmarPades`
 * (importado desde certificate-generator) sin reflowear el PDF.
 */

import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { CartaPorteInput } from './tipos.js';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 40;
const SIGNATURE_PLACEHOLDER_BYTES = 16384;

export async function generarPdfCartaPorte(input: CartaPorteInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Carta de Porte ${input.folio}`);
  pdf.setAuthor('Booster AI — boosterchile.com');
  pdf.setSubject('Carta de Porte Ley 18.290 Art. 174');
  pdf.setProducer('@booster-ai/carta-porte-generator');
  pdf.setCreator('@booster-ai/carta-porte-generator');

  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = A4_HEIGHT - MARGIN;

  // Title
  page.drawText('CARTA DE PORTE', {
    x: MARGIN,
    y,
    size: 18,
    font: helvBold,
    color: rgb(0, 0, 0),
  });
  y -= 22;
  page.drawText('Ley 18.290 — Art. 174 (Chile)', {
    x: MARGIN,
    y,
    size: 9,
    font: helv,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 24;

  // Folio + fecha
  drawKeyValueRow(page, helv, helvBold, MARGIN, y, [
    ['Folio', input.folio],
    ['Fecha', formatDate(input.emittedAt)],
  ]);
  y -= 24;

  // Sección: Porteador
  y = drawSectionHeader(page, helvBold, MARGIN, y, 'Porteador (transportista)');
  y = drawPersonBlock(page, helv, helvBold, MARGIN, y, input.porteador);

  // Sección: Cargador
  y = drawSectionHeader(page, helvBold, MARGIN, y, 'Cargador (generador de carga)');
  y = drawPersonBlock(page, helv, helvBold, MARGIN, y, input.cargador);

  // Sección: Consignatario
  y = drawSectionHeader(page, helvBold, MARGIN, y, 'Consignatario (receptor)');
  y = drawPersonBlock(page, helv, helvBold, MARGIN, y, input.consignatario);

  // Sección: Origen + destino
  y = drawSectionHeader(page, helvBold, MARGIN, y, 'Trayecto');
  y = drawLine(
    page,
    helv,
    helvBold,
    MARGIN,
    y,
    'Origen',
    `${input.origen.direccion}, ${input.origen.comuna}, ${input.origen.region}`,
  );
  y = drawLine(
    page,
    helv,
    helvBold,
    MARGIN,
    y,
    'Destino',
    `${input.destino.direccion}, ${input.destino.comuna}, ${input.destino.region}`,
  );
  y -= 8;

  // Sección: Carga
  y = drawSectionHeader(page, helvBold, MARGIN, y, 'Características de la carga');
  y = drawLine(page, helv, helvBold, MARGIN, y, 'Naturaleza', input.carga.naturaleza);
  y = drawLine(
    page,
    helv,
    helvBold,
    MARGIN,
    y,
    'Cantidad',
    `${input.carga.cantidad} ${input.carga.unidad}`,
  );
  y = drawLine(page, helv, helvBold, MARGIN, y, 'Peso bruto', `${input.carga.pesoKg} kg`);
  if (input.carga.volumenM3 !== undefined) {
    y = drawLine(page, helv, helvBold, MARGIN, y, 'Volumen', `${input.carga.volumenM3} m³`);
  }
  y = drawLine(page, helv, helvBold, MARGIN, y, 'Embalaje', input.carga.embalaje);
  if (input.carga.observaciones) {
    y = drawLine(page, helv, helvBold, MARGIN, y, 'Observaciones', input.carga.observaciones);
  }
  y -= 8;

  // Sección: Vehículo
  y = drawSectionHeader(page, helvBold, MARGIN, y, 'Vehículo');
  y = drawLine(page, helv, helvBold, MARGIN, y, 'Patente', input.vehiculo.patente);
  y = drawLine(page, helv, helvBold, MARGIN, y, 'Tipo', input.vehiculo.tipo);
  if (input.vehiculo.anioModelo !== undefined) {
    y = drawLine(page, helv, helvBold, MARGIN, y, 'Año', String(input.vehiculo.anioModelo));
  }
  if (input.vehiculo.color) {
    y = drawLine(page, helv, helvBold, MARGIN, y, 'Color', input.vehiculo.color);
  }
  y -= 8;

  // Sección: Conductor
  y = drawSectionHeader(page, helvBold, MARGIN, y, 'Conductor');
  y = drawLine(page, helv, helvBold, MARGIN, y, 'Nombre', input.conductor.nombre);
  y = drawLine(page, helv, helvBold, MARGIN, y, 'RUT', input.conductor.rut);
  y = drawLine(
    page,
    helv,
    helvBold,
    MARGIN,
    y,
    'Licencia',
    `${input.conductor.licenciaClase} N° ${input.conductor.licenciaNumero}`,
  );
  y -= 8;

  // Sección: Comercial (opcional)
  if (input.precioFleteClp !== undefined) {
    y = drawSectionHeader(page, helvBold, MARGIN, y, 'Información comercial');
    y = drawLine(
      page,
      helv,
      helvBold,
      MARGIN,
      y,
      'Precio del flete (CLP, c/IVA)',
      formatClp(input.precioFleteClp),
    );
    y -= 8;
  }

  // Footer: verificación + nota legal
  const footerY = MARGIN + 30;
  if (input.verifyUrl) {
    page.drawText(`Verificación: ${input.verifyUrl}`, {
      x: MARGIN,
      y: footerY + 12,
      size: 8,
      font: helv,
      color: rgb(0.3, 0.3, 0.3),
    });
  }
  page.drawText(
    'Este documento fue generado y firmado digitalmente por Booster AI. La firma PAdES embebida garantiza integridad y autenticidad.',
    {
      x: MARGIN,
      y: footerY,
      size: 7,
      font: helv,
      color: rgb(0.45, 0.45, 0.45),
      maxWidth: A4_WIDTH - MARGIN * 2,
    },
  );

  // Serialize + insertar placeholder PAdES (mismo patrón que
  // certificate-generator → permite reusar `firmarPades` directo).
  // useObjectStreams: false → @signpdf necesita xref clásico para
  // calcular el ByteRange del placeholder; con object streams no parsea.
  const pdfBytes = await pdf.save({ useObjectStreams: false });
  return plainAddPlaceholder({
    pdfBuffer: Buffer.from(pdfBytes),
    reason: 'Firma electrónica Carta de Porte — Booster AI',
    contactInfo: 'firmas@boosterchile.com',
    name: 'Booster AI',
    location: 'Santiago, Chile',
    signatureLength: SIGNATURE_PLACEHOLDER_BYTES,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
  });
}

// ============================================================================
// Helpers de layout
// ============================================================================

type PdfPage = ReturnType<PDFDocument['addPage']>;
type PdfFont = Awaited<ReturnType<PDFDocument['embedFont']>>;

function drawSectionHeader(
  page: PdfPage,
  bold: PdfFont,
  x: number,
  y: number,
  label: string,
): number {
  page.drawText(label, {
    x,
    y,
    size: 10,
    font: bold,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawLine({
    start: { x, y: y - 3 },
    end: { x: A4_WIDTH - MARGIN, y: y - 3 },
    color: rgb(0.7, 0.7, 0.7),
    thickness: 0.5,
  });
  return y - 16;
}

function drawLine(
  page: PdfPage,
  helv: PdfFont,
  bold: PdfFont,
  x: number,
  y: number,
  label: string,
  value: string,
): number {
  page.drawText(`${label}:`, { x, y, size: 9, font: bold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(value, {
    x: x + 110,
    y,
    size: 9,
    font: helv,
    color: rgb(0, 0, 0),
    maxWidth: A4_WIDTH - x - 110 - MARGIN,
  });
  return y - 12;
}

function drawKeyValueRow(
  page: PdfPage,
  helv: PdfFont,
  bold: PdfFont,
  x: number,
  y: number,
  pairs: Array<[string, string]>,
): void {
  let cursorX = x;
  const cellWidth = (A4_WIDTH - MARGIN * 2) / pairs.length;
  for (const [k, v] of pairs) {
    page.drawText(`${k}:`, {
      x: cursorX,
      y,
      size: 9,
      font: bold,
      color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(v, {
      x: cursorX + 40,
      y,
      size: 9,
      font: helv,
      color: rgb(0, 0, 0),
    });
    cursorX += cellWidth;
  }
}

function drawPersonBlock(
  page: PdfPage,
  helv: PdfFont,
  bold: PdfFont,
  x: number,
  y: number,
  p: CartaPorteInput['porteador'],
): number {
  let cursor = y;
  cursor = drawLine(page, helv, bold, x, cursor, 'Nombre', p.nombre);
  cursor = drawLine(page, helv, bold, x, cursor, 'RUT', p.rut);
  cursor = drawLine(
    page,
    helv,
    bold,
    x,
    cursor,
    'Dirección',
    `${p.direccion}, ${p.comuna}, ${p.region}`,
  );
  if (p.email || p.telefono) {
    const contact = [p.email, p.telefono].filter(Boolean).join(' / ');
    cursor = drawLine(page, helv, bold, x, cursor, 'Contacto', contact);
  }
  return cursor - 8;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatClp(amount: number): string {
  return `$${amount.toLocaleString('es-CL')}`;
}
