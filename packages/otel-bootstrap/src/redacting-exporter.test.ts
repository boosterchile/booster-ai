import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { RedactingSpanExporter } from './index.js';

/**
 * Review security 2026-06-11 (BLOQUEANTE resuelto): la instrumentación
 * HTTP captura URLs completas; el SSE del chat lleva `?auth=<Firebase ID
 * token>` — sin scrubbing, una credencial bearer viva quedaba legible en
 * Cloud Trace (~30 días, audiencia cloudtrace.viewer).
 */
function fakeSpan(attributes: Record<string, unknown>): ReadableSpan {
  return { attributes } as unknown as ReadableSpan;
}

describe('RedactingSpanExporter', () => {
  it('redacta el VALOR de auth= en http.url/url.query, preserva el resto', async () => {
    const inner = new InMemorySpanExporter();
    const exporter = new RedactingSpanExporter(inner);
    const span = fakeSpan({
      'http.url':
        'https://api.boosterchile.com/assignments/a1/messages/stream?auth=eyJSECRET.JWT&since=5',
      'url.query': 'auth=eyJSECRET.JWT&since=5',
      'http.method': 'GET',
      'http.status_code': 200,
    });

    await new Promise<void>((resolve) => exporter.export([span], () => resolve()));

    const exported = inner.getFinishedSpans()[0] as unknown as {
      attributes: Record<string, unknown>;
    };
    expect(exported.attributes['http.url']).toBe(
      'https://api.boosterchile.com/assignments/a1/messages/stream?auth=[REDACTED]&since=5',
    );
    expect(exported.attributes['url.query']).toBe('auth=[REDACTED]&since=5');
    expect(String(exported.attributes['http.url'])).not.toContain('SECRET');
    expect(exported.attributes['http.method']).toBe('GET');
    expect(exported.attributes['http.status_code']).toBe(200);
  });

  it('redacta token/key/access_token/signature; URLs sin params sensibles intactas', async () => {
    const inner = new InMemorySpanExporter();
    const exporter = new RedactingSpanExporter(inner);
    const span = fakeSpan({
      a: 'https://x/cb?token=t1&key=k1&access_token=a1&signature=s1',
      b: 'https://x/flota?region=RM&page=2',
    });

    await new Promise<void>((resolve) => exporter.export([span], () => resolve()));

    const out = inner.getFinishedSpans()[0] as unknown as { attributes: Record<string, unknown> };
    expect(out.attributes.a).toBe(
      'https://x/cb?token=[REDACTED]&key=[REDACTED]&access_token=[REDACTED]&signature=[REDACTED]',
    );
    expect(out.attributes.b).toBe('https://x/flota?region=RM&page=2');
  });
});
