import { describe, expect, it } from 'vitest';
import { cn } from './cn.js';

describe('cn()', () => {
  it('resuelve conflictos de utilities Tailwind — la última gana (tailwind-merge)', () => {
    // Caso de conflicto exigido por la spec: sin tailwind-merge quedarían las dos.
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-danger-500', 'text-neutral-900')).toBe('text-neutral-900');
    expect(cn('p-2', 'px-4')).toBe('p-2 px-4'); // no conflictan (p vs px)
  });

  it('descarta falsy y respeta condicionales (clsx)', () => {
    expect(cn('block', false, undefined, null, 'w-full')).toBe('block w-full');
    const hasError = true;
    expect(cn('border', hasError ? 'border-danger-500' : 'border-neutral-300')).toBe(
      'border border-danger-500',
    );
  });

  it('preserva clases no conflictivas', () => {
    expect(cn('rounded-md px-3 py-2', 'shadow-xs')).toBe('rounded-md px-3 py-2 shadow-xs');
  });
});
