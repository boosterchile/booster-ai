import { describe, expect, it } from 'vitest';
import { parseTedDd } from './parse-ted-dd.js';

/**
 * Estructura oficial del TED (Instructivo Técnico SII, ANEXO 2 — gate C-7).
 * Ejemplo basado en la Figura A.6 del Instructivo:
 *
 *   <RE>=RUT EMISOR, <TD>=tipo DTE, <F>=folio, <FE>=fecha emisión,
 *   <RR>=RUT RECEPTOR, <RSR>=razón social DEL RECEPTOR, <MNT>=monto total.
 *
 * Invariante crítico (gate C-7 §1): RE=emisor, RR=receptor. NO confundir.
 * razon_social_emisor NO viene en el <DD> (solo <RSR> del receptor).
 */
const TED_FIXTURE = `<TED version="1.0">
  <DD>
    <RE>76111111-1</RE>
    <TD>52</TD>
    <F>67</F>
    <FE>2026-06-11</FE>
    <RR>12345678-5</RR>
    <RSR>Comprador S.A.</RSR>
    <MNT>24365</MNT>
    <IT1>Caja de Zapatos</IT1>
    <CAF version="1.0"><DA><RE>76111111-1</RE></DA></CAF>
    <TSTED>2026-06-11T07:34:15</TSTED>
  </DD>
  <FRMT algoritmo="SHA1withRSA">ZmFrZS1zaWduYXR1cmU=</FRMT>
</TED>`;

describe('parseTedDd — mapeo <DD> → documentos_transporte (gate C-7)', () => {
  it('mapea RE=emisor, RR=receptor, RSR=razón social del receptor (no confundir)', () => {
    const result = parseTedDd(TED_FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.fields.rutEmisor).toBe('76111111-1');
    expect(result.fields.rutReceptor).toBe('12345678-5');
    expect(result.fields.razonSocialReceptor).toBe('Comprador S.A.');
  });

  it('mapea TD→docType, F→folio, FE→fechaEmision, MNT→montoTotal', () => {
    const result = parseTedDd(TED_FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.fields.docType).toBe('52');
    expect(result.fields.folio).toBe('67');
    expect(result.fields.fechaEmision).toBe('2026-06-11');
    expect(result.fields.montoTotal).toBe('24365');
  });

  it('razon_social_emisor NO viene del <DD> → queda null (gate C-7 §2)', () => {
    const result = parseTedDd(TED_FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.fields.razonSocialEmisor).toBeNull();
  });

  it('conserva el TED crudo (ted_raw) para auditoría (IT1/CAF/TSTED no mapeados)', () => {
    const result = parseTedDd(TED_FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.tedRaw).toContain('<TED');
    expect(result.tedRaw).toContain('<CAF');
  });

  it('un <TD> fuera del catálogo SII → docType="other" sin romper', () => {
    const ted = TED_FIXTURE.replace('<TD>52</TD>', '<TD>999</TD>');
    const result = parseTedDd(ted);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.fields.docType).toBe('other');
  });

  it.each(['33', '34', '52', '56', '61'])('reconoce el código DTE %s del catálogo', (code) => {
    const ted = TED_FIXTURE.replace('<TD>52</TD>', `<TD>${code}</TD>`);
    const result = parseTedDd(ted);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.fields.docType).toBe(code);
  });

  it('tolera <MNT> ausente (ej. guía sin valor) → montoTotal null', () => {
    const ted = TED_FIXTURE.replace('<MNT>24365</MNT>', '');
    const result = parseTedDd(ted);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.fields.montoTotal).toBeNull();
  });

  it('XML que no es un TED válido (sin <DD>) → ok:false', () => {
    const result = parseTedDd('<html><body>no soy un timbre</body></html>');
    expect(result.ok).toBe(false);
  });

  it('string vacío → ok:false', () => {
    expect(parseTedDd('').ok).toBe(false);
  });

  it('XML malformado → ok:false (no lanza)', () => {
    const result = parseTedDd('<TED><DD><RE>76111111-1');
    expect(result.ok).toBe(false);
  });

  it('normaliza FE a YYYY-MM-DD; una fecha en otro formato → fechaEmision null', () => {
    const ted = TED_FIXTURE.replace('<FE>2026-06-11</FE>', '<FE>11/06/2026</FE>');
    const result = parseTedDd(ted);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.fields.fechaEmision).toBeNull();
  });

  /**
   * Defensa XXE / billion-laughs (entity expansion DoS). El TED del SII es XML
   * simple sin DOCTYPE ni entidades custom: un `<!DOCTYPE>` o `<!ENTITY>` en el
   * payload (que viene de un PDF417 de tercero, no confiable) se rechaza ANTES
   * de parsear y NUNCA se expande.
   */
  describe('defensa entity-expansion / XXE (gate seguridad)', () => {
    it('rechaza un payload billion-laughs (entidades anidadas) sin expandirlas', () => {
      const evil = [
        '<?xml version="1.0"?>',
        '<!DOCTYPE lolz [',
        '<!ENTITY lol "lol">',
        '<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">',
        '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">',
        ']>',
        '<TED version="1.0"><DD><RE>&lol3;</RE></DD></TED>',
      ].join('');
      const result = parseTedDd(evil);
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.reason).toBe('xml_doctype_forbidden');
    });

    it('rechaza cualquier <!DOCTYPE ...> aunque no traiga entidades', () => {
      const withDoctype = `<?xml version="1.0"?><!DOCTYPE TED>${TED_FIXTURE}`;
      const result = parseTedDd(withDoctype);
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.reason).toBe('xml_doctype_forbidden');
    });

    it('rechaza un <!ENTITY> declarado sin DOCTYPE inline detectable', () => {
      const withEntity = `<!ENTITY xxe SYSTEM "file:///etc/passwd">${TED_FIXTURE}`;
      const result = parseTedDd(withEntity);
      expect(result.ok).toBe(false);
    });

    it('NO expande entidades XML estándar en el contenido de un tag (las deja literales o las ignora)', () => {
      // `&amp;` es la única entidad que un TED legítimo podría traer (escape de
      // `&` en una razón social). Con processEntities:false el parser la deja
      // como texto crudo; lo crítico es que NUNCA se haga expansión recursiva.
      const ted = TED_FIXTURE.replace(
        '<RSR>Comprador S.A.</RSR>',
        '<RSR>Pérez &amp; Cía S.A.</RSR>',
      );
      const result = parseTedDd(ted);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      // No se valida la forma exacta del `&amp;` (literal vs decodificado), solo
      // que el parse no explote ni cuelgue por expansión.
      expect(result.fields.razonSocialReceptor).toContain('Cía S.A.');
    });
  });
});
