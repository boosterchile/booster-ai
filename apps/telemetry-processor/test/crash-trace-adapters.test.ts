import type { BigQuery } from '@google-cloud/bigquery';
import type { Storage } from '@google-cloud/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  createBigQueryCrashTraceIndexer,
  createGcsCrashTraceUploader,
} from '../src/crash-trace-adapters.js';

describe('createGcsCrashTraceUploader', () => {
  it('llama bucket.file.save con contentType json y resumable=false', async () => {
    const save = vi.fn(async () => undefined);
    const file = vi.fn(() => ({ save }));
    const bucket = vi.fn(() => ({ file }));
    const storage = { bucket } as unknown as Storage;

    const uploader = createGcsCrashTraceUploader(storage);
    await uploader.upload({
      bucketName: 'crashes',
      objectPath: 'imei/356/2024-01-01/abc.json',
      jsonContent: '{"foo":"bar"}',
    });

    expect(bucket).toHaveBeenCalledWith('crashes');
    expect(file).toHaveBeenCalledWith('imei/356/2024-01-01/abc.json');
    expect(save).toHaveBeenCalledWith(
      '{"foo":"bar"}',
      expect.objectContaining({
        contentType: 'application/json',
        resumable: false,
        metadata: expect.objectContaining({
          cacheControl: 'private, max-age=0, no-store',
        }),
      }),
    );
  });

  it('propaga error si save falla', async () => {
    const storage = {
      bucket: () => ({
        file: () => ({
          save: vi.fn(async () => {
            throw new Error('GCS down');
          }),
        }),
      }),
    } as unknown as Storage;

    const uploader = createGcsCrashTraceUploader(storage);
    await expect(
      uploader.upload({ bucketName: 'b', objectPath: 'x.json', jsonContent: '{}' }),
    ).rejects.toThrow('GCS down');
  });
});

describe('createBigQueryCrashTraceIndexer', () => {
  it('inserta con insertIds = [crash_id] para idempotencia', async () => {
    const insert = vi.fn(async () => undefined);
    const table = vi.fn(() => ({ insert }));
    const dataset = vi.fn(() => ({ table }));
    const bigquery = { dataset } as unknown as BigQuery;

    const indexer = createBigQueryCrashTraceIndexer(bigquery);
    const row = {
      crash_id: 'uuid-crash-1',
      imei: 'i',
      timestamp_ms: 1700000000000,
    };
    await indexer.insertRow({ datasetId: 'ds', tableId: 'tbl', row });

    expect(dataset).toHaveBeenCalledWith('ds');
    expect(table).toHaveBeenCalledWith('tbl');
    expect(insert).toHaveBeenCalledTimes(1);
    const [rows, opts] = insert.mock.calls[0] ?? [];
    expect(rows).toEqual([row]);
    expect(opts).toMatchObject({
      ignoreUnknownValues: false,
      skipInvalidRows: false,
      insertIds: ['uuid-crash-1'],
    });
  });

  it('propaga error si insert falla', async () => {
    const bigquery = {
      dataset: () => ({
        table: () => ({
          insert: vi.fn(async () => {
            throw new Error('BQ down');
          }),
        }),
      }),
    } as unknown as BigQuery;

    const indexer = createBigQueryCrashTraceIndexer(bigquery);
    await expect(
      indexer.insertRow({ datasetId: 'd', tableId: 't', row: { crash_id: 'x' } }),
    ).rejects.toThrow('BQ down');
  });
});
