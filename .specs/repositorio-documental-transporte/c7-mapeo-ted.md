# Gate C-7 — Mapeo del TED `<DD>` contra el SII (PROVISIONAL — sub-fase 4b)

**Fecha**: 2026-06-18 (mapeo inicial) · 2026-06-19 (re-validación)
**Estado**: 🟡 **C-7 PROVISIONAL — mapeo sin formato SII vigente CONFIRMADO. Cierre real BLOQUEADO** hasta que el owner confirme el documento del SII vía el portal vivo o lo provea.

## ⚠️ Por qué es PROVISIONAL (no cerrado)

El mapeo de abajo coincide tag-por-tag con documentos del SII que SÍ descargué y leí (no es conocimiento interno), **pero la VIGENCIA de la fuente no está verificada de forma externa/autoritativa**:

- El detalle tag-por-tag del `<DD>` proviene del **Instructivo Técnico fechado 15/10/2009** (`instructivo_emision.pdf`). Su currency se **asumió** ("el TED es estable ~17 años"), no se confirmó contra una versión publicada actual.
- El **catálogo `<TD>`** se confirmó contra `formato_dte_202602.pdf` (v2.5 2026-02, descargado y leído), pero su vigencia se apoya en el índice de búsqueda + fecha interna + que la URL resuelve — **NO** en el enlace vivo del portal SII (que da 404 / usa paneles colapsables tras la reorganización del sitio).
- Ambos PDFs se obtuvieron por **URL directa** (vía WebSearch), **no** navegando la ruta del portal vigente (1039-.html → 1039-1184.html → "Envío de DTE"), que no se pudo completar.
- El "Confirmado, usá v2.5" del PO fue un visto-bueno **sobre este reporte**, no una verificación externa independiente de la fuente.

**Para cerrar C-7 de verdad**: el owner confirma, vía el portal vivo del SII (o pasando el PDF), cuál es el documento de formato/Instructivo vigente; se re-valida contra ése.

## Mapeo (provisional) — fuentes descargadas: formato v2.5 2026-02 + Instructivo ANEXO 2 (2009)

- `formato_dte_202602.pdf` ([URL](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf), HTTP 200, leído con `pdftotext`: "Versión 2.5 / 2026-02", changelog "Cambios 16/02/2026") — aporta catálogo `<TD>` + descripción de alto nivel del TED; **remite al Instructivo** para el detalle.
- `instructivo_emision.pdf` ([URL](https://www.sii.cl/factura_electronica/instructivo_emision.pdf), HTTP 200, leído con `pdftotext`: "INSTRUCTIVO TÉCNICO FACTURA ELECTRÓNICA, 15/10/2009"), **ANEXO 2 §A.2.3 + Figura A.6** — aporta los tags del `<DD>`.
- **Resultado del mapeo**: el parser `parse-ted-dd.ts` (mergeado en #501) coincide tag-por-tag con estos documentos; el catálogo `<TD>` no cambió; emisor/receptor correctos. **Sujeto a confirmación de vigencia de la fuente** (ver arriba).

## Confirmación de vigencia (gate C-7.a) — ⚠️ NO cumplida (ver sección PROVISIONAL)
- Documento candidato: **FORMATO DOCUMENTOS TRIBUTARIOS ELECTRÓNICOS 2026-02, Versión 2.5** — [formato_dte_202602.pdf](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) (leído del propio PDF con `pdftotext`). Su **vigencia NO está confirmada** vía el portal vivo del SII; el gate C-7.a queda **pendiente** de confirmación externa del owner.
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

## Mapeo `<DD>` → parser → `documentos_transporte` (validado tag-por-tag)

Fuente: Instructivo ANEXO 2, A.2.3 + Figura A.6. Campo del parser: `parse-ted-dd.ts` (`fields.*`). Tipo SII: ASCII.

| Tag SII | Semántica oficial (ANEXO 2 §A.2.3) | Campo parser (`fields`) | Columna 4a | Validación C-7 |
|---|---|---|---|---|
| `<RE>` | **RUT del EMISOR** (`XXXXXXXX-X`) | `rutEmisor` | `rut_emisor` | ✓ coincide (EMISOR) |
| `<TD>` | Tipo DTE (catálogo SII, string) | `docType` (enum + `other`) | `doc_type` | ✓ catálogo confirmado |
| `<F>` | Folio (decimal entero, string) | `folio` | `folio` | ✓ |
| `<FE>` | **Fecha emisión** `AAAA-MM-DD` | `fechaEmision` (valida día real) | `fecha_emision` | ✓ formato confirmado — **ancla de retención** |
| `<RR>` | **RUT del RECEPTOR** (`XXXXXXXX-X`) | `rutReceptor` | `rut_receptor` | ✓ coincide (RECEPTOR) |
| `<RSR>` | Razón social **del receptor** (máx 40) | `razonSocialReceptor` | `razon_social_receptor` | ✓ es del RECEPTOR |
| `<MNT>` | Monto total CLP, entero sin decimales | `montoTotal` | `monto_total` | ✓ |
| `<IT1>` | Descripción 1er ítem (máx 40) | — (en `tedRaw`) | — | ✓ no se mapea a columna |
| `<CAF>` | Código de autorización de folios | — (en `tedRaw`) | — | ✓ se preserva sin decomponer |
| `<TSTED>` | Timestamp timbre `AAAA-MM-DDTHH:MI:SS` | — (en `tedRaw`) | — | ✓ |
| (n/a) | — (no existe tag de razón social del **emisor** en el `<DD>`) | `razonSocialEmisor = null` | `razon_social_emisor` | ✓ correcto: NULL desde TED (O-4) |

**Catálogo `<TD>` confirmado en el formato v2.5 (pág. 5)**: `33` Factura · `34` Factura No Afecta/Exenta · `52` Guía de Despacho · `56` Nota de Débito · `61` Nota de Crédito. El enum `doc_type` de 4a (`33/34/52/56/61/other`) los cubre; cualquier código fuera del catálogo → `other`. **Sin cambios de código**.

## Estructura del `<CAF>` (ANEXO 1) — documentada, NO parseada por 4b

El parser **no decompone** el `<CAF>` (lo conserva entero en `ted_raw`); se documenta para referencia futura (validación de la cadena CAF→llave SII, fuera de alcance — ver hallazgo 6):

```xml
<CAF version="1.0">
  <DA>
    <RE>76…-…</RE>        <!-- RUT empresa autorizada -->
    <TD>33</TD>            <!-- tipo DTE autorizado -->
    <RNG><D>1</D><H>100</H></RNG>  <!-- rango de folios Desde/Hasta -->
    <FA>2026-01-01</FA>    <!-- fecha autorización AAAA-MM-DD -->
    <RSAPK><M>…</M><E>…</E></RSAPK>  <!-- llave pública: módulo/exponente Base64 -->
    <IDK>300</IDK>         <!-- id llave pública SII -->
  </DA>
  <FRMA algoritmo="SHA1withRSA">…</FRMA>  <!-- firma SII del CAF -->
</CAF>
```

## Decisiones / hallazgos del gate
1. **Emisor vs receptor (error común) — despejado**: `<RE>` = RUT emisor, `<RR>` = RUT receptor, `<RSR>` = razón social **del receptor**. El parser NO debe confundirlos.
2. **`razon_social_emisor` NO viene en el `<DD>`** (solo `<RSR>` del receptor) → confirma **O-4**: queda `NULL` desde el TED; se completa solo por `manual-entry`. El worker no debe inventarla.
3. **Tipos DTE (`<TD>`)**: el código viaja como string (`"33"`). Catálogo relevante confirmado: **33** factura, **34** factura exenta, **52** guía de despacho (+ 56 nota débito, 61 nota crédito — estándar SII). El enum `doc_type` de 4a (`33/34/52/56/61/other`) los cubre; valores fuera del catálogo → `other`.
4. **`<FE>` → `fecha_emision`** (`AAAA-MM-DD`). Recalcular `retention_until = fecha_emision + 6a` **SOLO si estaba en fallback `created_at`**; **nunca acortar** una retención ya fijada (invariante O-3).
5. **`<MNT>`**: entero CLP sin decimales → `monto_total numeric`. Puede ser `0`/ausente en ciertos tipos (ej. guía sin valor) → tolerar.
6. **Verificación criptográfica de `<FRMT>` (SHA1withRSA con la pública del `<CAF>`): FUERA de alcance de 4b** (decisión explícita, no asumida). El worker extrae y persiste el `<DD>`; la validación de firma queda como mejora futura (requeriría validar la cadena CAF→llave SII).
7. **Tolerancia a fallo**: si el PDF417 no decodifica o el `<TED>`/`<DD>` no parsea → `extraction_status='fallido'`, el documento se conserva, y el cierre de la orden NO se bloquea (`REQUIRE_TED_DECODE=false`). Un campo opcional faltante jamás bloquea.
8. **Estructura del `<DD>` invariante por tipo de DTE**: el `<DD>` del TED tiene la MISMA estructura para Factura (33), Guía de Despacho (52), etc. — las diferencias de obligatoriedad por tipo viven en el CUERPO del DTE (Encabezado/Detalle), no en el timbre compacto. Por eso el parser no necesita lógica por `<TD>`: lee best-effort los 10 tags del `<DD>` (todos presentes en cualquier timbre válido) y tolera ausencias.
9. **Cambios 2026-02 del formato no tocan el TED**: el changelog v2.5 (Res. Ex. N°154/2025) agrega campos de transporte a la Guía de Despacho (patente carro/remolque, fecha/hora salida, fecha llegada) — están en la sección **Transporte del cuerpo del DTE**, NO en el `<DD>` del timbre. El parser de 4b (que solo lee el `<DD>` del PDF417) **no se ve afectado**. Sin cambios.
10. **Instructivo fechado 2009 — vigencia ASUMIDA, no confirmada**: el ANEXO 2 está fechado 15/10/2009. Se *asumió* que sigue vigente porque el formato v2.5 remite genéricamente "al Instructivo" y la estructura del `<DD>` es estable hace ~17 años. **Esto NO es una verificación**: no se confirmó que el 2009 sea la versión publicada actual del Instructivo. Es el punto débil del gate C-7.a (ver sección PROVISIONAL).

## Estado del gate C-7 (PR #505) — 🟡 PROVISIONAL, NO cerrado

🟡 **C-7 PROVISIONAL.** El mapeo del parser `parse-ted-dd.ts` coincide tag-por-tag con los documentos del SII descargados (formato v2.5 2026-02 para el catálogo `<TD>` + Instructivo ANEXO 2 de 2009 para el `<DD>`), el catálogo `<TD>` no cambió y emisor/receptor están correctos — **pero la VIGENCIA de esas fuentes no está confirmada externamente** (gate C-7.a no cumplido; ver sección PROVISIONAL arriba). **C-7 NO está cerrado.**

Lo único **verificado de forma independiente** (es código, no depende del formato SII): `<FE>` → `fecha_emision` con ancla **estricta** (`CASE WHEN fecha_emision IS NULL`, sin `GREATEST`; `created_at` solo fallback; nunca acortar una retención ya anclada — `document-store.ts` + tests behavioral pglite + review adversarial).

**Bloqueante para cerrar C-7**: el owner confirma, vía el portal vivo del SII (sii.cl → 1039-.html → 1039-1184.html → "Envío de DTE") o pasando el PDF, cuál es el documento de formato/Instructivo vigente. Recién ahí se re-valida y se pasa a ✅.
