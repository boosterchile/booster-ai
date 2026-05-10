# @booster-ai/coaching-generator

Generador de mensajes de coaching post-entrega para conductores Booster.

Phase 3 del feature "comportamiento en ruta para reducir huella de
carbono". Combina:

- **Path AI**: prompt curado + Gemini API via función `genFn` injectable.
  Modelo + tokens reportados para audit + cost.
- **Path plantilla**: fallback determinístico cuando Gemini falla o no
  está disponible. El conductor siempre recibe un mensaje útil.

## API pública

```ts
import { generarCoachingConduccion } from '@booster-ai/coaching-generator';

const result = await generarCoachingConduccion(
  {
    score: 78,
    nivel: 'bueno',
    desglose: {
      aceleracionesBruscas: 0,
      frenadosBruscos: 4,
      curvasBruscas: 0,
      excesosVelocidad: 0,
      eventosPorHora: 1.3,
    },
    trip: { distanciaKm: 250, duracionMinutos: 180, tipoCarga: 'carga_seca' },
  },
  {
    genFn: createGeminiGenFn({ apiKey, logger }),
  },
);

result.mensaje;       // "Detectamos 4 frenados bruscos. ..."
result.focoPrincipal; // 'frenado'
result.fuente;        // 'gemini' | 'plantilla'
result.modelo;        // 'gemini-1.5-flash' (si fuente='gemini')
```

## Eval suite (Phase 3 PR-J4)

12 casos golden cubriendo todos los focos posibles + edge cases (trip
corto/largo, carga frágil, carga perecible). Cada caso valida
**propiedades cualitativas** del output, no texto exacto:

- `longitud_max_320` — cabe en SMS / WhatsApp
- `longitud_min_30` — no acepta respuestas tipo "ok"
- `sin_emojis` — regla 7 del system prompt
- `sin_bullets` — regla 7
- `sin_dialecto_no_chileno` — sin "guey", "tío", "che", etc.
- `tono_respetuoso` — sin "deberías", "es tu culpa", "pésimo"
- `sin_fabricacion` — no inventa hora, día, clima, tráfico
- `es_espanol` — heurística por keywords frecuentes
- `foco_keyword_<foco>` — menciona la dimensión problemática

### Modos

**Hermetic (CI)** — `pnpm test`

Corre con `genFn` stubbed. Verifica que:
- Las propiedades **discriminan correctamente** (outputs malos fallan).
- El runner integra bien con `generarCoachingConduccion` (fuente, foco,
  fallback se reportan bien).
- La plantilla determinística pasa todas las propiedades base.

**Live (opt-in)** — `GEMINI_API_KEY=AIza... pnpm eval:live`

Corre los 12 casos contra Gemini real. Imprime reporte humano-legible y
guarda JSON timestamped en `eval-results/` para tracking de regresión
histórica. Costo por run: ~$0.0001 (gemini-1.5-flash).

Sin `GEMINI_API_KEY`, el script sale con instrucciones — no es error,
es opt-in.

### Cuándo correr live

- Después de cualquier cambio a `src/prompt.ts` (system prompt o
  `buildUserPrompt`).
- Antes de cambiar de modelo (e.g. flash → pro, o flash → 2.0).
- Antes de cambiar `temperature` / `maxOutputTokens` /
  `safetySettings` en el wrapper de gemini-client.
- Sanity check semanal (manual o vía cron) para detectar drift del
  modelo (Gemini Flash recibe updates silenciosos).

### Cómo agregar un caso nuevo

1. Editar `src/evals/casos.ts` y agregar un objeto al array
   `CASOS_GOLDEN`.
2. El test `'cada caso tiene foco esperado consistente con su desglose'`
   valida que `focoEsperado` matchee con
   `determinarFocoPrincipal(params.desglose)`.
3. Si el caso requiere una propiedad nueva (no cubierta por las
   ~9 base), agregar a `propiedades` la nueva `PropiedadEval` inline.
4. Re-correr `pnpm test` y `pnpm eval:live` para validar que el caso
   pasa con genFn perfecto + Gemini real.

## Refs

- [Phase 3 PR-J1](../../docs/handoff/CURRENT.md) — package skeleton +
  plantilla determinística
- [Phase 3 PR-J2](../../docs/handoff/CURRENT.md) — wrapper Gemini API +
  persistencia
- [Playbook 002 — Canal coaching: voz, no WhatsApp](../../playbooks/002-canal-coaching-voz-no-whatsapp.md)
  — decisión de canal del delivery (Phase 4 redefinida)
