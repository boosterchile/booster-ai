/**
 * Implementación del puerto `ObjectDownloader` sobre GCS. Descarga el objeto
 * que 4a archivó (NO lo borra ni reescribe — prohibido por O-3, retención
 * legal). El worker solo LEE el binario para decodificar el TED.
 */

import { Storage } from '@google-cloud/storage';
import type { ObjectDownloader } from './process-document-uploaded.js';

export function createGcsDownloader(opts: {
  bucket: string;
  projectId: string;
}): ObjectDownloader {
  const storage = new Storage({ projectId: opts.projectId });
  return {
    async download(filePath: string): Promise<Uint8Array> {
      const [contents] = await storage.bucket(opts.bucket).file(filePath).download();
      return new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength);
    },
  };
}
