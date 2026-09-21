/**
 * Panel reutilizable «Documentos de transporte» (Guía 52 / Factura 33).
 *
 * Se monta en:
 *   - `/app/asignaciones/$id` (oficina transportista) — `tripId` viene del
 *     detalle de la assignment (`trip_request.id`, NO el assignment id).
 *   - `/app/cargas/$id/track` (generador) — el param de ruta ya es el viaje.
 *
 * Copy vos rioplatense. Escritura (`dueno|admin|despachador`) la decide el
 * caller vía `canWrite`; el API refuerza el mismo gate.
 */

import type { DocType } from '@booster-ai/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, FileText, Loader2, Upload } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import {
  DOC_TYPE_LABEL,
  EXTRACTION_STATUS_LABEL,
  type TransportDocumentListItem,
  humanizeTransportDocumentError,
  listTransportDocuments,
  needsManualEntry,
  openTransportDocumentDownload,
  submitManualEntry,
  uploadTransportDocument,
} from '../../lib/transport-documents-api.js';

export interface TransportDocumentsPanelProps {
  tripId: string;
  canWrite: boolean;
  /** Compacto para el bottom card del track del generador. */
  compact?: boolean;
}

const DOC_TYPE_OPTIONS: DocType[] = ['52', '33', '34', '56', '61', 'other'];

export function TransportDocumentsPanel({
  tripId,
  canWrite,
  compact = false,
}: TransportDocumentsPanelProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const listQ = useQuery({
    queryKey: ['transport-documents', tripId],
    queryFn: () => listTransportDocuments(tripId),
  });

  const uploadM = useMutation({
    mutationFn: (file: File) => uploadTransportDocument(tripId, file),
    onSuccess: () => {
      setBanner({ kind: 'ok', text: 'Documento subido. Quedó pendiente de lectura.' });
      void queryClient.invalidateQueries({ queryKey: ['transport-documents', tripId] });
    },
    onError: (err) => {
      setBanner({ kind: 'error', text: humanizeTransportDocumentError(err) });
    },
  });

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) {
      return;
    }
    setBanner(null);
    uploadM.mutate(file);
  };

  const docs = listQ.data ?? [];
  const inner = (
    <>
      {banner && (
        <output
          className={
            banner.kind === 'error'
              ? 'block rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs'
              : 'block rounded-md border border-success-200 bg-success-50 p-2 text-success-700 text-xs'
          }
        >
          {banner.kind === 'error' && (
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />
          )}
          {banner.text}
        </output>
      )}

      {listQ.isLoading && (
        <p className="inline-flex items-center gap-2 text-neutral-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando documentos…
        </p>
      )}

      {listQ.isError && (
        <p className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs">
          {humanizeTransportDocumentError(listQ.error)}
        </p>
      )}

      {!listQ.isLoading && !listQ.isError && docs.length === 0 && (
        <p className="text-neutral-600 text-sm">
          Todavía no hay documentos. Empezá subiendo la guía o la factura.
        </p>
      )}

      {docs.length > 0 && (
        <ul className="space-y-3">
          {docs.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              tripId={tripId}
              canWrite={canWrite}
              onDownloadError={(msg) => setBanner({ kind: 'error', text: msg })}
            />
          ))}
        </ul>
      )}

      {canWrite && (
        <div className="pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            className="sr-only"
            onChange={onFileChange}
            aria-label="Subí un PDF o una foto"
            data-testid="transport-doc-file"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadM.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-3 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {uploadM.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4" aria-hidden />
            )}
            {uploadM.isPending ? 'Subiendo…' : 'Subí un PDF o una foto'}
          </button>
          <p className="mt-1 text-neutral-500 text-xs">PDF, JPEG o PNG · máximo 15 MB.</p>
        </div>
      )}
    </>
  );

  if (compact) {
    return (
      <details
        className="rounded-md border border-neutral-200 bg-white"
        data-testid="transport-docs-panel"
        data-trip-id={tripId}
      >
        <summary className="cursor-pointer px-3 py-2 font-medium text-neutral-900 text-sm">
          Documentos de transporte{docs.length > 0 ? ` (${docs.length})` : ''}
        </summary>
        <div className="space-y-3 border-neutral-100 border-t px-3 py-3">{inner}</div>
      </details>
    );
  }

  return (
    <section
      aria-label="Documentos de transporte"
      className="border-neutral-200 border-b bg-white px-4 py-3"
      data-testid="transport-docs-panel"
      data-trip-id={tripId}
    >
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="font-semibold text-neutral-900 text-sm">Documentos de transporte</h2>
            <p className="mt-1 text-neutral-600 text-xs">
              Guía 52 o Factura 33 que amparan esta carga.
            </p>
          </div>
          {inner}
        </div>
      </div>
    </section>
  );
}

function DocumentRow({
  doc,
  tripId,
  canWrite,
  onDownloadError,
}: {
  doc: TransportDocumentListItem;
  tripId: string;
  canWrite: boolean;
  onDownloadError: (msg: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const showManual = canWrite && needsManualEntry(doc.extractionStatus);

  const onDownload = async () => {
    setDownloading(true);
    try {
      await openTransportDocumentDownload(doc.id);
    } catch (err) {
      onDownloadError(humanizeTransportDocumentError(err));
    } finally {
      setDownloading(false);
    }
  };

  const statusTone =
    doc.extractionStatus === 'fallido'
      ? 'text-danger-700'
      : doc.extractionStatus === 'decodificado' || doc.extractionStatus === 'ingreso_manual'
        ? 'text-success-700'
        : 'text-amber-700';

  return (
    <li
      className="rounded-md border border-neutral-200 p-3"
      data-testid={`transport-doc-${doc.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-neutral-900 text-sm">
            {DOC_TYPE_LABEL[doc.docType]}
            {doc.folio ? ` · folio ${doc.folio}` : ''}
          </p>
          <p className={`mt-0.5 text-xs ${statusTone}`}>
            {EXTRACTION_STATUS_LABEL[doc.extractionStatus]}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onDownload()}
          disabled={downloading}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-neutral-700 text-xs hover:bg-neutral-50 disabled:opacity-50"
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden />
          )}
          Descargá
        </button>
      </div>
      {showManual && <ManualEntryForm documentId={doc.id} tripId={tripId} />}
    </li>
  );
}

function ManualEntryForm({ documentId, tripId }: { documentId: string; tripId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<DocType>('52');
  const [folio, setFolio] = useState('');
  const [rutEmisor, setRutEmisor] = useState('');
  const [rutReceptor, setRutReceptor] = useState('');
  const [fechaEmision, setFechaEmision] = useState('');
  const [montoTotal, setMontoTotal] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const saveM = useMutation({
    mutationFn: () =>
      submitManualEntry(documentId, {
        doc_type: docType,
        ...(folio.trim() ? { folio: folio.trim() } : {}),
        ...(rutEmisor.trim() ? { rut_emisor: rutEmisor.trim() } : {}),
        ...(rutReceptor.trim() ? { rut_receptor: rutReceptor.trim() } : {}),
        ...(fechaEmision ? { fecha_emision: fechaEmision } : {}),
        ...(montoTotal.trim() ? { monto_total: montoTotal.trim() } : {}),
      }),
    onSuccess: () => {
      setFormError(null);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['transport-documents', tripId] });
    },
    onError: (err) => {
      setFormError(humanizeTransportDocumentError(err));
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveM.mutate();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-primary-700 text-xs underline"
      >
        Completar a mano
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 grid gap-2 sm:grid-cols-2"
      data-testid="manual-entry-form"
    >
      <label className="flex flex-col gap-1 text-neutral-700 text-xs">
        Tipo
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocType)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        >
          {DOC_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {DOC_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-neutral-700 text-xs">
        Folio
        <input
          value={folio}
          onChange={(e) => setFolio(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-neutral-700 text-xs">
        RUT emisor
        <input
          value={rutEmisor}
          onChange={(e) => setRutEmisor(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-neutral-700 text-xs">
        RUT receptor
        <input
          value={rutReceptor}
          onChange={(e) => setRutReceptor(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-neutral-700 text-xs">
        Fecha de emisión
        <input
          type="date"
          value={fechaEmision}
          onChange={(e) => setFechaEmision(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-neutral-700 text-xs">
        Monto
        <input
          value={montoTotal}
          onChange={(e) => setMontoTotal(e.target.value)}
          inputMode="decimal"
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
      </label>
      {formError && (
        <p className="text-danger-700 text-xs sm:col-span-2" role="alert">
          {formError}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={saveM.isPending}
          className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {saveM.isPending ? 'Guardando…' : 'Guardá'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 text-sm"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
