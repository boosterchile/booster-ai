/**
 * Parser del `<TED>` (Timbre Electrónico Documento) PDF417 de un DTE chileno.
 *
 * Estructura oficial validada en el gate C-7 (Instructivo Técnico SII, ANEXO 2):
 *
 *   <TED version="1.0">
 *     <DD>
 *       <RE>RUT EMISOR</RE>     <TD>tipo DTE</TD>   <F>folio</F>
 *       <FE>AAAA-MM-DD</FE>     <RR>RUT RECEPTOR</RR>
 *       <RSR>razón social DEL RECEPTOR</RSR>        <MNT>monto total CLP</MNT>
 *       <IT1>...</IT1>  <CAF>...</CAF>  <TSTED>...</TSTED>
 *     </DD>
 *     <FRMT algoritmo="SHA1withRSA">...firma...</FRMT>
 *   </TED>
 *
 * Mapeo a las columnas de `documentos_transporte` (4a):
 *   RE → rut_emisor · TD → doc_type · F → folio · FE → fecha_emision
 *   RR → rut_receptor · RSR → razon_social_receptor · MNT → monto_total
 *
 * INVARIANTES del gate C-7:
 *   1. RE = emisor, RR = receptor, RSR = razón social DEL RECEPTOR. No confundir.
 *   2. `razon_social_emisor` NO viene en el <DD> → queda null (solo manual-entry).
 *   6. La verificación criptográfica de <FRMT> está FUERA de alcance de 4b: el
 *      worker extrae y persiste el <DD>; no valida la firma.
 *
 * Función PURA: parsea el XML del timbre (ya decodificado del PDF417). No toca
 * red ni binarios WASM.
 */

import { docTypeSchema } from '@booster-ai/shared-schemas';
import type { DocType } from '@booster-ai/shared-schemas';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface TedFields {
  rutEmisor: string | null;
  /** Código SII del catálogo (`33`/`34`/`52`/`56`/`61`) o `other`. */
  docType: DocType;
  folio: string | null;
  /** ISO date YYYY-MM-DD del `<FE>`; null si no es ISO date válido. */
  fechaEmision: string | null;
  rutReceptor: string | null;
  /** Razón social DEL RECEPTOR (`<RSR>`). El emisor NO viene en el <DD>. */
  razonSocialReceptor: string | null;
  /** Siempre null desde el TED: no hay tag de razón social del emisor (C-7 §2). */
  razonSocialEmisor: null;
  /** Monto total CLP entero como string; null si ausente (ej. guía sin valor). */
  montoTotal: string | null;
}

export type ParseTedResult =
  | { ok: true; fields: TedFields; tedRaw: string }
  | { ok: false; reason: string };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Detecta una declaración DOCTYPE o ENTITY en el XML crudo. El TED del SII es
 * XML simple (sin DOCTYPE ni entidades custom): un payload con `<!DOCTYPE>` o
 * `<!ENTITY>` solo puede ser un intento de XXE / entity-expansion (billion
 * laughs). Viene de un PDF417 de tercero (no confiable) → se rechaza ANTES de
 * parsear. Defensa en profundidad: el parser ya corre con `processEntities`
 * desactivado (no expande), pero igual no aceptamos el documento.
 */
const DOCTYPE_OR_ENTITY_RE = /<!\s*(DOCTYPE|ENTITY)\b/i;

const parser = new XMLParser({
  ignoreAttributes: true,
  // Conservamos los valores como string: `<F>67</F>` o `<MNT>24365</MNT>` no
  // deben coercionarse a number (perderíamos el formato y la semántica de
  // "string opcional"). El folio y el monto se persisten como text/numeric.
  parseTagValue: false,
  trimValues: true,
  // Seguridad: NUNCA expandir entidades. El TED no usa entidades custom; con
  // esto un `&lol3;` anidado (billion laughs) jamás se expande recursivamente
  // ni se resuelve un SYSTEM/PUBLIC external (XXE). Las entidades XML estándar
  // (`&amp;`, `&lt;`…) quedan como texto crudo, suficiente para auditoría.
  processEntities: false,
});

/** Normaliza un valor de tag a string no vacío, o null. */
function tagToString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

/** Mapea el `<TD>` al enum `doc_type`; fuera del catálogo → `other`. */
function mapDocType(rawTd: string | null): DocType {
  if (rawTd === null) {
    return 'other';
  }
  const parsed = docTypeSchema.safeParse(rawTd);
  return parsed.success ? parsed.data : 'other';
}

export function parseTedDd(xml: string): ParseTedResult {
  const raw = xml?.trim();
  if (!raw) {
    return { ok: false, reason: 'empty' };
  }

  // Defensa XXE / entity-expansion: rechazamos cualquier DOCTYPE/ENTITY antes
  // de tocar el parser. El TED legítimo nunca los trae; su presencia es un
  // intento de billion-laughs o de leer un recurso externo (SYSTEM/PUBLIC).
  if (DOCTYPE_OR_ENTITY_RE.test(raw)) {
    return { ok: false, reason: 'xml_doctype_forbidden' };
  }

  // `fast-xml-parser` es leniente (auto-cierra tags): un PDF417 truncado o
  // dañado parsearía a un DD parcial en silencio. Validamos primero el XML
  // bien-formado (tags balanceados) para rechazar timbres dañados → fallido.
  const validity = XMLValidator.validate(raw);
  if (validity !== true) {
    return { ok: false, reason: 'xml_not_wellformed' };
  }

  let doc: unknown;
  try {
    doc = parser.parse(raw);
  } catch {
    return { ok: false, reason: 'xml_parse_error' };
  }

  // Navegamos TED → DD de forma defensiva (el XML viene de un PDF417 ajeno).
  const ted = (doc as Record<string, unknown> | null)?.TED as Record<string, unknown> | undefined;
  const dd = ted?.DD as Record<string, unknown> | undefined;
  if (!dd || typeof dd !== 'object') {
    return { ok: false, reason: 'no_dd' };
  }

  const feRaw = tagToString(dd.FE);
  const fechaEmision = feRaw && ISO_DATE_RE.test(feRaw) ? feRaw : null;

  const fields: TedFields = {
    rutEmisor: tagToString(dd.RE),
    docType: mapDocType(tagToString(dd.TD)),
    folio: tagToString(dd.F),
    fechaEmision,
    rutReceptor: tagToString(dd.RR),
    razonSocialReceptor: tagToString(dd.RSR),
    razonSocialEmisor: null,
    montoTotal: tagToString(dd.MNT),
  };

  return { ok: true, fields, tedRaw: raw };
}
