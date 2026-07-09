/**
 * Contraste WCAG 2.x — matemática pura, zero-dep.
 *
 * Fundamento de la a11y verificada por construcción del registro "producto"
 * (D1, DESIGN.md D-5/D-8). El test `contrast.test.ts` usa estas funciones para
 * fallar el CI si alguna rampa (acento ×7, semánticos, neutrales) no cumple los
 * umbrales exigidos por el PO — en claro y oscuro. Reemplaza el axe-core
 * "fantasma" (dep sin cablear) por verificación real de los tokens.
 *
 * Referencia: WCAG 2.1 §1.4.3 (contraste mínimo) — relative luminance +
 * contrast ratio. https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */

/** Umbrales WCAG AA. */
export const WCAG_AA_TEXT = 4.5; // texto normal
export const WCAG_AA_UI = 3; // componentes UI, bordes, íconos, texto grande

/**
 * Parsea un hex `#RGB` o `#RRGGBB` a [r,g,b] en 0..255. Lanza si el formato
 * es inválido — un token mal escrito debe romper el test, no degradar en
 * silencio.
 */
export function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.trim().replace(/^#/, '');
  // Expande forma corta `RGB` → `RRGGBB` sin indexado ambiguo.
  const full = cleaned.length === 3 ? cleaned.replace(/./g, (c) => c + c) : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`hex inválido: ${JSON.stringify(hex)}`);
  }
  const int = Number.parseInt(full, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/** Canal sRGB 0..255 → componente lineal 0..1 (gamma expand, WCAG). */
function channelToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance WCAG (0 = negro, 1 = blanco). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/**
 * Contrast ratio entre dos colores (1..21). Simétrico: el orden no importa.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Redondeo a 2 decimales para mensajes de test legibles. */
export function ratio2(a: string, b: string): number {
  return Math.round(contrastRatio(a, b) * 100) / 100;
}
