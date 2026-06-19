# Gate C-7 — Mapeo del TED `<DD>` validado contra el SII (sub-fase 4b)

**Fecha**: 2026-06-18
**Estado**: ✅ validado contra fuente oficial antes de fijar el parser.

## Confirmación de vigencia (gate C-7.a)
- Documento de formato vigente del SII: **FORMATO DOCUMENTOS TRIBUTARIOS ELECTRÓNICOS 2026-02, Versión 2.5** — [formato_dte_202602.pdf](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) (confirmado vigente vía búsqueda web 2026-06-18; el archivo `formato_dte_202602.pdf` sigue siendo el actual).
- Ese PDF (sección **G. Timbre Electrónico SII del Documento**, pág. 49) describe el timbre a alto nivel — *"firma electrónica sobre campos representativos del DTE: Rut Emisor, Rut Receptor, Tipo Documento, Folio, IVA, Monto Neto y CAF"* — y **remite al Instructivo Técnico** para el detalle tag-por-tag.
- Detalle autoritativo del `<DD>`: **[Instructivo Técnico de Emisión](https://www.sii.cl/factura_electronica/instructivo_emision.pdf), ANEXO 2 "Timbre Electrónico del DTE"** (estructura + descripción campo a campo + ejemplo oficial Figura A.6).

## Estructura del TED (oficial)
```xml
<TED version="1.0">
  <DD>
    <RE>11111111-1</RE>          <!-- RUT EMISOR (XXXXXXXX-X) -->
    <TD>33</TD>                   <!-- Tipo DTE -->
    <F>67</F>                     <!-- Folio (entero) -->
    <FE>2002-06-11</FE>          <!-- Fecha emisión AAAA-MM-DD -->
    <RR>12345678-5</RR>          <!-- RUT RECEPTOR (XXXXXXXX-X) -->
    <RSR>Comprador S.A.</RSR>    <!-- Razón social DEL RECEPTOR (máx 40) -->
    <MNT>24365</MNT>             <!-- Monto total CLP entero, sin decimales -->
    <IT1>Caja de Zapatos</IT1>   <!-- Descripción 1er ítem (máx 40) -->
    <CAF>...</CAF>               <!-- Código autorización de folios -->
    <TSTED>2002-06-11T07:34:15</TSTED> <!-- Timestamp timbre AAAA-MM-DDTHH:MI:SS -->
  </DD>
  <FRMT algoritmo="SHA1withRSA">...</FRMT>  <!-- firma del SII -->
</TED>
```

## Mapeo `<DD>` → `documentos_transporte` (columnas de 4a)
| Tag | Semántica oficial (Instructivo §A.2) | Columna | Obligatoriedad |
|---|---|---|---|
| `<RE>` | **RUT del EMISOR** del DTE | `rut_emisor` | presente en todo DTE timbrado |
| `<TD>` | Tipo DTE (catálogo SII) | `doc_type` | presente |
| `<F>` | Folio (decimal entero) | `folio` | presente |
| `<FE>` | **Fecha de emisión** `AAAA-MM-DD` | `fecha_emision` | presente — **ancla de retención** |
| `<RR>` | **RUT del RECEPTOR** | `rut_receptor` | presente |
| `<RSR>` | Razón social **del receptor** (máx 40) | `razon_social_receptor` | presente |
| `<MNT>` | Monto total CLP (entero) | `monto_total` | presente (puede ser 0 en algunos tipos) |
| `<IT1>` | Descripción 1er ítem (máx 40) | — (en `ted_raw`) | presente |
| `<CAF>` | Autorización de folios | — (en `ted_raw`) | presente |
| `<TSTED>` | Timestamp del timbre | — (en `ted_raw`) | presente |

## Decisiones / hallazgos del gate
1. **Emisor vs receptor (error común) — despejado**: `<RE>` = RUT emisor, `<RR>` = RUT receptor, `<RSR>` = razón social **del receptor**. El parser NO debe confundirlos.
2. **`razon_social_emisor` NO viene en el `<DD>`** (solo `<RSR>` del receptor) → confirma **O-4**: queda `NULL` desde el TED; se completa solo por `manual-entry`. El worker no debe inventarla.
3. **Tipos DTE (`<TD>`)**: el código viaja como string (`"33"`). Catálogo relevante confirmado: **33** factura, **34** factura exenta, **52** guía de despacho (+ 56 nota débito, 61 nota crédito — estándar SII). El enum `doc_type` de 4a (`33/34/52/56/61/other`) los cubre; valores fuera del catálogo → `other`.
4. **`<FE>` → `fecha_emision`** (`AAAA-MM-DD`). Recalcular `retention_until = fecha_emision + 6a` **SOLO si estaba en fallback `created_at`**; **nunca acortar** una retención ya fijada (invariante O-3).
5. **`<MNT>`**: entero CLP sin decimales → `monto_total numeric`. Puede ser `0`/ausente en ciertos tipos (ej. guía sin valor) → tolerar.
6. **Verificación criptográfica de `<FRMT>` (SHA1withRSA con la pública del `<CAF>`): FUERA de alcance de 4b** (decisión explícita, no asumida). El worker extrae y persiste el `<DD>`; la validación de firma queda como mejora futura (requeriría validar la cadena CAF→llave SII).
7. **Tolerancia a fallo**: si el PDF417 no decodifica o el `<TED>`/`<DD>` no parsea → `extraction_status='fallido'`, el documento se conserva, y el cierre de la orden NO se bloquea (`REQUIRE_TED_DECODE=false`). Un campo opcional faltante jamás bloquea.
