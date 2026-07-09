import { RegisterProvider } from '@booster-ai/ui-components';
import {
  ACCENT_GLOW,
  ACCENT_PRESET_LABEL,
  type AccentPalette,
  DENSITY_KEYS,
  DENSITY_LABEL,
  type DensityKey,
  REGISTER_KEYS,
  REGISTER_LABEL,
  type RegisterKey,
  allAccentPresets,
} from '@booster-ai/ui-tokens';
import { useState } from 'react';
import { useAccentPreset } from '../hooks/use-accent-preset.js';

/**
 * /apariencia — selector de acento del registro producto (D-4/D-5).
 *
 * Demostrador del theming en runtime: elegir un preset cambia el acento EN VIVO
 * (setea `data-accent` en <html> → bloque `[data-accent]` del theme generado,
 * sin rebuild). Dos paletas por ROL — conductor (LED vibrante) y operador
 * (sobria). En la app la paleta la fija el rol; acá (ruta pública, sin login)
 * se toggle-ea para demostrar ambas. El selector definitivo (settings) es D2/D3.
 * Ruta pública a propósito: preferencia client-side inocua, sin datos.
 */
export function AparienciaRoute() {
  const [palette, setPalette] = useState<AccentPalette>('operator');
  const [current, setAccent, keys] = useAccentPreset(palette);
  // Demostrador de registro/densidad (D2 Ola 0): CSS-driven vía data-attribute.
  const [register, setRegister] = useState<RegisterKey>('operador');
  const [density, setDensity] = useState<DensityKey>('comoda');

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">Apariencia</h1>
        <p className="mt-1 text-neutral-600 text-sm">
          Elegí el color de acento de tu Booster. Cambia al instante.
        </p>

        {/* Toggle de paleta (en la app lo fija el rol; acá se demuestra) */}
        <fieldset className="mt-5 inline-flex rounded-md border border-neutral-200 p-0.5">
          <legend className="sr-only">Paleta por rol</legend>
          {(
            [
              ['operator', 'Operador'],
              ['conductor', 'Conductor'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-testid={`palette-toggle-${value}`}
              aria-pressed={palette === value}
              onClick={() => setPalette(value)}
              className={`rounded px-3 py-1.5 font-medium text-sm transition ${
                palette === value
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {label}
            </button>
          ))}
        </fieldset>

        <fieldset className="mt-5" data-testid="accent-selector">
          <legend className="sr-only">Color de acento</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {keys.map((key) => {
              const selected = current === key;
              // Swatch: el glow decorativo si existe (fluor neón), si no el 500.
              const swatch = ACCENT_GLOW[key] ?? allAccentPresets[key][500];
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
                  <span
                    aria-hidden
                    className="h-5 w-5 shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: swatch }}
                  />
                  {ACCENT_PRESET_LABEL[key]}
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Demo del acento ACTIVO: usa las utilities de acento (bg/text) que
            cambian en vivo. El botón usa texto BLANCO (nunca negro). */}
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

        {/* Registro y densidad (D2 Ola 0) — CSS-driven vía data-attribute, mismo
            patrón runtime que el acento. RegisterProvider co-loca
            data-register/data-density en un ancestro; el elemento de muestra
            consume var(--touch-min)/var(--pad-y)/... y cambia EN VIVO, sin
            rebuild. En la app el registro lo fija el rol. */}
        <div className="mt-8 border-neutral-200 border-t pt-6">
          <p className="mb-1 font-medium text-neutral-900 text-sm">Registro y densidad</p>
          <p className="mb-3 text-neutral-500 text-xs">
            Mismos componentes base, configurados distinto: conductor holgado (guantes/movimiento),
            operador denso. Cambia al instante.
          </p>

          <div className="flex flex-wrap gap-4">
            <fieldset
              className="inline-flex rounded-md border border-neutral-200 p-0.5"
              data-testid="register-selector"
            >
              <legend className="sr-only">Registro</legend>
              {REGISTER_KEYS.map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`register-toggle-${value}`}
                  aria-pressed={register === value}
                  onClick={() => setRegister(value)}
                  className={`rounded px-3 py-1.5 font-medium text-sm transition ${
                    register === value
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  {REGISTER_LABEL[value]}
                </button>
              ))}
            </fieldset>

            <fieldset
              className="inline-flex rounded-md border border-neutral-200 p-0.5"
              data-testid="density-selector"
            >
              <legend className="sr-only">Densidad</legend>
              {DENSITY_KEYS.map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`density-toggle-${value}`}
                  aria-pressed={density === value}
                  onClick={() => setDensity(value)}
                  className={`rounded px-3 py-1.5 font-medium text-sm transition ${
                    density === value
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  {DENSITY_LABEL[value]}
                </button>
              ))}
            </fieldset>
          </div>

          {/* Muestra: el ancestro lleva data-register/data-density; los hijos
              se dimensionan SOLO por las custom properties del theme. */}
          <RegisterProvider
            register={register}
            density={density}
            className="mt-4 flex flex-col rounded-md bg-neutral-50 p-4"
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gap)' }}>
              <button
                type="button"
                data-testid="register-sample-button"
                className="rounded-md bg-accent-600 font-medium text-sm text-white"
                style={{
                  minHeight: 'var(--touch-min)',
                  paddingBlock: 'var(--pad-y)',
                  paddingInline: 'var(--pad-x)',
                }}
              >
                Acción
              </button>
              <span
                data-testid="register-sample-chip"
                className="inline-flex items-center rounded-md border border-neutral-300 text-neutral-700 text-sm"
                style={{
                  minHeight: 'var(--touch-min)',
                  paddingBlock: 'var(--pad-y)',
                  paddingInline: 'var(--pad-x)',
                }}
              >
                Fila de datos
              </span>
            </div>
          </RegisterProvider>
        </div>
      </div>
    </div>
  );
}
