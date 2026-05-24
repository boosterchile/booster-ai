import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { redactValue } from './redaction.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '..', 'test', 'fixtures');

interface LegitEntry {
  category: string;
  text: string;
}

interface AdversarialEntry {
  category: string;
  text: string;
  expectedMarker: string;
}

const legit = JSON.parse(
  readFileSync(resolve(FIXTURES, 'legit-1000.json'), 'utf8'),
) as LegitEntry[];
const adversarial = JSON.parse(
  readFileSync(resolve(FIXTURES, 'adversarial-100.json'), 'utf8'),
) as AdversarialEntry[];

const ALL_MARKERS = ['[REDACTED:email]', '[REDACTED:phone]', '[REDACTED:rut]', '[REDACTED:jwt]'];

describe('redaction thresholds (T6 SC-H4.1)', () => {
  it('fixture sizes match spec contract', () => {
    expect(legit.length).toBe(1000);
    expect(adversarial.length).toBe(100);
  });

  it('false positive rate <=1% sobre legit-1000', () => {
    const falsePositives = legit.filter((entry) => {
      const out = redactValue(entry.text);
      return ALL_MARKERS.some((m) => out.includes(m));
    });
    const rate = falsePositives.length / legit.length;
    if (rate > 0.01) {
      console.error(
        'FP examples (first 5):',
        falsePositives.slice(0, 5).map((e) => ({ category: e.category, text: e.text })),
      );
    }
    expect(rate).toBeLessThanOrEqual(0.01);
  });

  it('false negative rate <=5% sobre adversarial-100', () => {
    const falseNegatives = adversarial.filter(
      (entry) => !redactValue(entry.text).includes(entry.expectedMarker),
    );
    const rate = falseNegatives.length / adversarial.length;
    if (rate > 0.05) {
      console.error(
        'FN examples (first 5):',
        falseNegatives.slice(0, 5).map((e) => ({
          category: e.category,
          text: e.text,
          expectedMarker: e.expectedMarker,
        })),
      );
    }
    expect(rate).toBeLessThanOrEqual(0.05);
  });
});
