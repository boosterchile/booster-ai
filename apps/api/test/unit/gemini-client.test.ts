import { describe, expect, it, vi } from 'vitest';
import { createGeminiGenFn } from '../../src/services/gemini-client.js';

// google-auth-library mockeada globalmente en test/setup.ts (ADR-038).

function makeFetchOkWithText(text: string): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: { parts: [{ text }] },
          finishReason: 'STOP',
        },
      ],
    }),
    text: async () => '',
  })) as unknown as typeof fetch;
}

function makeFetchError(status: number, body = '{"error":"..."}'): typeof fetch {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  })) as unknown as typeof fetch;
}

describe('createGeminiGenFn — happy path', () => {
  it('llama a Vertex AI endpoint con Authorization Bearer + projectId path', async () => {
    const fetchSpy = makeFetchOkWithText('Coaching message ejemplo');
    const genFn = createGeminiGenFn({
      projectId: 'booster-ai-test',
      fetchImpl: fetchSpy,
    });

    const out = await genFn({
      systemPrompt: 'Eres un coach',
      userPrompt: 'Dame feedback',
    });

    expect(out).toBe('Coaching message ejemplo');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const calls = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls;
    const url = calls[0]?.[0] as string;
    expect(url).toContain('aiplatform.googleapis.com');
    expect(url).toContain('projects/booster-ai-test/locations/southamerica-east1');
    expect(url).toContain(':generateContent');
    const init = calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-access-token');
  });

  it('body incluye systemInstruction + contents + generationConfig + safetySettings', async () => {
    const fetchSpy = makeFetchOkWithText('ok');
    const genFn = createGeminiGenFn({
      projectId: 'p',
      fetchImpl: fetchSpy,
    });
    await genFn({ systemPrompt: 'SYS', userPrompt: 'USER' });

    const init = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] });
    expect((body.contents as unknown[])[0]).toEqual({
      role: 'user',
      parts: [{ text: 'USER' }],
    });
    expect((body.generationConfig as Record<string, unknown>).temperature).toBe(0.2);
    expect((body.safetySettings as unknown[]).length).toBe(4);
  });

  it('override de location y model se reflejan en la URL', async () => {
    const fetchSpy = makeFetchOkWithText('ok');
    const genFn = createGeminiGenFn({
      projectId: 'p',
      location: 'us-central1',
      model: 'gemini-2.0-flash',
      fetchImpl: fetchSpy,
    });
    await genFn({ systemPrompt: 'S', userPrompt: 'U' });

    const url = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('us-central1-aiplatform.googleapis.com');
    expect(url).toContain('models/gemini-2.0-flash:generateContent');
  });
});

describe('createGeminiGenFn — fallback paths (devuelven null)', () => {
  it('non-2xx response → null', async () => {
    const fetchImpl = makeFetchError(500, '{"error":"backend"}');
    const genFn = createGeminiGenFn({ projectId: 'p', fetchImpl });
    const out = await genFn({ systemPrompt: 'S', userPrompt: 'U' });
    expect(out).toBeNull();
  });

  it('response sin candidates → null', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [] }),
      text: async () => '',
    })) as unknown as typeof fetch;
    const genFn = createGeminiGenFn({ projectId: 'p', fetchImpl });
    const out = await genFn({ systemPrompt: 'S', userPrompt: 'U' });
    expect(out).toBeNull();
  });

  it('finishReason ≠ STOP → null (safety block o truncation)', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: 'partial' }] },
            finishReason: 'SAFETY',
          },
        ],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;
    const genFn = createGeminiGenFn({ projectId: 'p', fetchImpl });
    const out = await genFn({ systemPrompt: 'S', userPrompt: 'U' });
    expect(out).toBeNull();
  });

  it('texto vacío en candidate → null', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '   ' }] }, finishReason: 'STOP' }],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;
    const genFn = createGeminiGenFn({ projectId: 'p', fetchImpl });
    const out = await genFn({ systemPrompt: 'S', userPrompt: 'U' });
    expect(out).toBeNull();
  });

  it('fetch throw (network error) → null', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const genFn = createGeminiGenFn({ projectId: 'p', fetchImpl });
    const out = await genFn({ systemPrompt: 'S', userPrompt: 'U' });
    expect(out).toBeNull();
  });
});
