/**
 * Script para correr la eval suite contra Gemini API real (Phase 3 PR-J4).
 *
 * Uso:
 *
 *   GEMINI_API_KEY=AIza... pnpm --filter @booster-ai/coaching-generator eval:live
 *
 * Sin la env var, sale con instrucciones (no falla — es opt-in).
 *
 * Output: reporte en stdout + archivo JSON timestamped en
 * `packages/coaching-generator/eval-results/<timestamp>.json`
 * para tracking de regresión histórica.
 *
 * Costo aproximado: 12 casos × ~150 input tokens + ~100 output tokens
 *   = ~1.8K input + 1.2K output tokens
 *   = $0.0001 por run (gemini-1.5-flash precio actual). Cero impacto
 *   en budget.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ejecutarEvals, formatearReporte } from '../src/evals/index.js';
import type { GenerarTextoFn } from '../src/tipos.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-1.5-flash';
const TIMEOUT_MS = 15_000; // un poco más generoso que prod (10s) — eval tolera más latencia

/**
 * Implementación stand-alone del genFn contra Gemini. Duplicada del
 * `apps/api/src/services/gemini-client.ts` deliberadamente — el package
 * no debe depender de `apps/`. Si la lógica diverge, el caso de prod
 * gana; el eval puede quedar desactualizado y eso lo expone al usuario
 * via diferencia de outputs.
 */
function buildGenFn(apiKey: string, model: string): GenerarTextoFn {
  return async ({ systemPrompt, userPrompt }) => {
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 200,
        topK: 40,
        topP: 0.95,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        process.stderr.write(`HTTP ${response.status}: ${errBody.slice(0, 200)}\n`);
        return null;
      }
      const json = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
      };
      const candidate = json.candidates?.[0];
      if (!candidate) {
        return null;
      }
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        process.stderr.write(`finishReason=${candidate.finishReason}\n`);
        return null;
      }
      const text = candidate.content?.parts?.[0]?.text?.trim();
      return text && text.length > 0 ? text : null;
    } catch (err) {
      process.stderr.write(
        `gemini fetch error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.startsWith('ROTATE_ME')) {
    process.stderr.write(
      'GEMINI_API_KEY no está seteado. Eval live skipeado.\n' +
        'Para correr la eval contra Gemini real:\n' +
        '  GEMINI_API_KEY=AIza... pnpm --filter @booster-ai/coaching-generator eval:live\n',
    );
    process.exit(0); // No es un error — es opt-in.
  }

  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const genFn = buildGenFn(apiKey, model);

  process.stderr.write(`Corriendo eval suite contra ${model}…\n`);
  const reporte = await ejecutarEvals({ genFn, modelo: model });

  // Stdout: reporte humano-legible.
  process.stdout.write(`${formatearReporte(reporte)}\n`);

  // File: JSON estructurado para diff entre runs.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const outDir = join(__dirname, '..', 'eval-results');
  await mkdir(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = join(outDir, `${ts}.json`);
  await writeFile(
    outFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        model,
        ...reporte,
      },
      null,
      2,
    ),
    'utf8',
  );
  process.stderr.write(`Reporte JSON: ${outFile}\n`);

  // Exit code refleja resultado — útil para CI / cron.
  process.exit(reporte.ok ? 0 : 1);
}

void main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(2);
});
