import { describe, expect, it } from 'vitest';
import { booleanFlag } from './booleanFlag.js';

describe('booleanFlag (anti-footgun z.coerce.boolean)', () => {
  const schema = booleanFlag(false);

  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['false', false],
    ['False', false],
    ['0', false],
    ['', false],
    [' true ', true],
  ])('parsea %j → %s', (input, expected) => {
    expect(schema.parse(input)).toBe(expected);
  });

  it('undefined → defaultValue', () => {
    expect(booleanFlag(false).parse(undefined)).toBe(false);
    expect(booleanFlag(true).parse(undefined)).toBe(true);
  });

  it('valor no reconocido → defaultValue (no true ciego)', () => {
    expect(booleanFlag(false).parse('yes')).toBe(false);
    expect(booleanFlag(true).parse('garbage')).toBe(true);
  });

  it('boolean nativo pasa directo', () => {
    expect(schema.parse(true)).toBe(true);
    expect(schema.parse(false)).toBe(false);
  });
});
