/**
 * Builder de paths convencionales en Cloud Storage. ADR-007 § "Arquitectura
 * de almacenamiento".
 *
 * Convención: `/<tipo-canonical>/{year}/{month}/<filename>`. Los tipos
 * que pueden agruparse comparten prefijo (ej. `dte_52`, `dte_33`,
 * `dte_34` → `/dte/`). `month` siempre con leading zero (`01`-`12`)
 * para que `gsutil ls` ordene cronológico.
 *
 * Mes basado en UTC para consistencia cross-region. Si el caller
 * necesita locale (ej. agrupar por mes Chile), debería override-ear el
 * builder.
 */

import type { DocumentType } from './types.js';

const PREFIX_BY_TYPE: Record<DocumentType, string> = {
  dte_52: 'dte',
  dte_33: 'dte',
  dte_34: 'dte',
  carta_porte: 'carta-porte',
  acta_entrega: 'actas',
  foto_pickup: 'photos/pickup',
  foto_delivery: 'photos/delivery',
  firma_entrega: 'signatures',
  checklist_vehiculo: 'checklists',
  factura_combustible: 'external-upload',
  certificado_esg: 'certificates',
};

export function gcsPathFor(args: {
  type: DocumentType;
  /**
   * Identifier que va al final del nombre. Para DTEs: folio (ej. "12345").
   * Para carta_porte: trackingCode. Para fotos: tripId-driverId.
   */
  identifier: string;
  /**
   * Extensión sin punto. Para DTE XML: "xml" + un `.pdf` paralelo.
   * Para fotos: "jpg". Default `pdf`.
   */
  extension?: string;
  /**
   * Fecha que decide el bucket de mes. Default `new Date()`.
   */
  emittedAt?: Date;
}): string {
  const at = args.emittedAt ?? new Date();
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  const prefix = PREFIX_BY_TYPE[args.type];
  const ext = args.extension ?? 'pdf';
  const safeIdentifier = args.identifier.replace(/[^A-Za-z0-9_-]/g, '_');
  // Algunos tipos tienen filename custom. Centralizado acá para
  // que rotaciones de convención sean 1 cambio.
  const filename = filenameFor(args.type, safeIdentifier, ext);
  return `${prefix}/${year}/${month}/${filename}`;
}

function filenameFor(type: DocumentType, identifier: string, ext: string): string {
  switch (type) {
    case 'dte_52':
      return `guia-${identifier}.${ext}`;
    case 'dte_33':
    case 'dte_34':
      return `factura-${identifier}.${ext}`;
    case 'carta_porte':
      return `cp-${identifier}.${ext}`;
    case 'acta_entrega':
      return `acta-${identifier}.${ext}`;
    case 'firma_entrega':
      return `sign-${identifier}.${ext}`;
    case 'foto_pickup':
      return `pickup-${identifier}.${ext}`;
    case 'foto_delivery':
      return `delivery-${identifier}.${ext}`;
    case 'checklist_vehiculo':
      return `checklist-${identifier}.${ext}`;
    case 'factura_combustible':
      return `${identifier}.${ext}`;
    case 'certificado_esg':
      return `cert-${identifier}.${ext}`;
  }
}

/**
 * Path de la versión PII-redactada del documento. Se construye sumando
 * `.redacted.pdf` al objectName base.
 */
export function redactedPathFor(originalPath: string): string {
  return `${originalPath}.redacted.pdf`;
}
