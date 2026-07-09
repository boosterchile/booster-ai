import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Une class names condicionales (clsx) y resuelve conflictos de utilities
 * Tailwind con la última ganando (tailwind-merge). Es la base de toda primitiva:
 * el caller pasa clases extra y `cn` decide el merge sin que el caller pelee.
 *
 *   cn('px-2', condicion && 'px-4')  // → 'px-4' cuando condicion
 *   cn('border-neutral-300', hasError && 'border-danger-500')
 *
 * `tailwind-merge` es la línea v3 (compatible con Tailwind 4; la v2 es legacy).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
