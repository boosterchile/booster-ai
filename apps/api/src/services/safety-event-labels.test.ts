import { describe, expect, it } from 'vitest';
import { safetyEventLabel } from './safety-event-labels.js';

describe('safetyEventLabel', () => {
  it('mapea cada tipo a su label en español', () => {
    expect(safetyEventLabel('crash')).toBe('Posible colisión');
    expect(safetyEventLabel('unplug')).toBe('Desconexión de energía (manipulación)');
    expect(safetyEventLabel('jamming')).toBe('Interferencia de señal GPS');
  });
});
