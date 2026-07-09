import { ACCENT_PRESET_KEYS, ACCENT_PRESET_LABEL, accentPresets } from '@booster-ai/ui-tokens';
import { useAccentPreset } from '../hooks/use-accent-preset.js';

/**
 * /apariencia — selector de acento del registro producto (D1 · H4).
 *
 * Demostrador MÍNIMO del theming en runtime (D-5): elegir un preset cambia el
 * acento EN VIVO (setea `data-accent` en <html> → el bloque `[data-accent]` del
 * theme generado re-tematiza sin rebuild). El selector "bonito" y su ubicación
 * definitiva (settings) son D2/D3. Ruta pública a propósito: es una preferencia
 * client-side inocua (localStorage), sin datos ni privilegio — permite probar el
 * theming sin fricción de auth.
 */
export function AparienciaRoute() {
  const [current, setAccent] = useAccentPreset();

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">Apariencia</h1>
        <p className="mt-1 text-neutral-600 text-sm">
          Elegí el color de acento de tu Booster. Cambia al instante.
        </p>

        <fieldset className="mt-6" data-testid="accent-selector">
          <legend className="sr-only">Color de acento</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ACCENT_PRESET_KEYS.map((key) => {
              const selected = current === key;
              return (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                    selected
                      ? 'border-accent-500 bg-accent-50 text-accent-800'
                      : 'border-neutral-200 text-neutral-700 hover:border-neutral-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="accent"
                    value={key}
                    checked={selected}
                    onChange={() => setAccent(key)}
                    data-testid={`accent-option-${key}`}
                    className="sr-only"
                  />
                  {/* Preview del preset (su propio 600), independiente del activo. */}
                  <span
                    aria-hidden
                    className="h-5 w-5 shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: accentPresets[key][600] }}
                  />
                  {ACCENT_PRESET_LABEL[key]}
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Demo del acento ACTIVO: usa las utilities de acento (bg/text) que
            cambian en vivo al elegir un preset. */}
        <div className="mt-8 border-neutral-200 border-t pt-6">
          <p className="mb-3 text-neutral-500 text-xs">Vista previa (acento activo)</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-md bg-accent-600 px-4 py-2 font-medium text-sm text-white"
              data-testid="accent-preview-button"
            >
              Botón de acento
            </button>
            <span className="rounded-full bg-accent-50 px-3 py-1 font-medium text-accent-800 text-sm">
              Etiqueta tint
            </span>
            <a href="/apariencia" className="font-medium text-accent-700 text-sm hover:underline">
              Enlace de acento
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
