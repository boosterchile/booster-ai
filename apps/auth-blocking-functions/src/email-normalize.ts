// `punycode` (without `node:` prefix and without trailing slash) resolves to
// the npm userland package, not the deprecated Node builtin. `node:punycode`
// is deprecated since Node 7 and slated for removal; the userland fork
// (maintained by `mathias`) is the stable choice.
// biome-ignore lint/style/useNodejsImportProtocol: userland npm package, not Node builtin
import { toUnicode } from 'punycode';

/**
 * Sprint 2c-A T5 — email canonicalization for admin-approval gate
 * lookup (per spec §9 R-2C-9).
 *
 * Applied transformations (in order):
 *   1. `trim()` — leading/trailing whitespace (incl. tab, newline).
 *   2. `normalize('NFC')` — Unicode canonical composition. Defends
 *      against NFD-vs-NFC equivalence (e.g., decomposed `é`
 *      → precomposed `é`).
 *   3. `toLowerCase()` — case-insensitive comparison. RFC 5321 §2.4
 *      says local-part is technically case-sensitive but virtually
 *      every email provider treats it as case-insensitive; matching
 *      that pragmatic behavior matches admin-approval UX.
 *   4. `punycode.toUnicode(domain)` — IDN decode. Defends against
 *      `josé@xn--mller-kva.de` vs `josé@müller.de` divergence (same
 *      domain, two encodings). DB store form is what admin enters
 *      during approval; gate canonicalizes incoming email to the
 *      same canonical form for lookup.
 *
 * **Explicitly NOT applied** (per plan v4 acceptance):
 *   - Gmail dot collapsing (`foo.bar@gmail.com` ≠ `foobar@gmail.com`):
 *     would be Gmail-provider-specific; admin may approve users that
 *     register from any provider. Local-part dots preserved as-is.
 *   - Gmail plus-aliasing strip (`foo+anything@gmail.com`): same
 *     reasoning. Preserved.
 *   - Sub-addressing (RFC 5233): preserved.
 *
 * Edge cases:
 *   - Empty input → empty string.
 *   - No `@` → input returned unchanged after transforms 1-3
 *     (no domain to decode).
 *   - Multiple `@` → `lastIndexOf('@')` splits at the last `@`,
 *     consistent with most email parsers; conforms to RFC 5321 §4.1.2.
 */
export function normalizeEmail(input: string): string {
  const cleaned = input.trim().normalize('NFC').toLowerCase();
  const atIdx = cleaned.lastIndexOf('@');
  if (atIdx < 0) {
    return cleaned;
  }
  const local = cleaned.slice(0, atIdx);
  const domain = cleaned.slice(atIdx + 1);
  return `${local}@${toUnicode(domain)}`;
}
