import { describe, expect, it } from 'vitest';
import { escaparHtml } from './escapar-html.js';

describe('escaparHtml', () => {
  it('escapa los cinco caracteres con significado en HTML', () => {
    expect(escaparHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('deja intacto el texto común, con tildes y eñes', () => {
    expect(escaparHtml('Transportes Peñalolén Ltda.')).toBe('Transportes Peñalolén Ltda.');
  });
});
