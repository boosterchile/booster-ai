# Gate C-7 — Mapeo del TED `<DD>` validado contra el SII (sub-fase 4b)

**Fecha**: 2026-06-18 (validación inicial) · **2026-06-19 (re-validación / cierre del gate, PR #501)**
**Estado**: ✅ **C-7 validado contra FORMATO DTE v2.5 2026-02 (confirmado por el PO) + Instructivo Técnico ANEXO 2 — SIN DISCREPANCIAS.**

## Re-validación 2026-06-19 (cierre del gate C-7 antes del merge de #501)

Re-verificación con fuente confirmada por el PO, no asumida:

- **Fuente vigente confirmada por el PO (2026-06-19)**: **FORMATO DOCUMENTOS TRIBUTARIOS ELECTRÓNICOS — Versión 2.5 — 2026-02** ([formato_dte_202602.pdf](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf), HTTP 200, 54 págs). Verificado leyendo el **propio PDF** (`pdftotext`): header "Versión 2.5 / 2026-02"; changelog interno más reciente **"Cambios 16/02/2026"** (incluye campos de transporte de Guía de Despacho por Res. Ex. N°154/2025). Nota de proceso: los aliases estables del portal (`/factura_electronica/formato_dte.pdf`) dan 404 tras la reorganización del sitio; el archivo **versionado** sí resuelve.
- **Detalle tag-por-tag del `<DD>`**: [Instructivo Técnico de Emisión](https://www.sii.cl/factura_electronica/instructivo_emision.pdf), **ANEXO 2 "Timbre Electrónico del DTE"** (A.2.3 Estructura + Figura A.6). El Instructivo está fechado **15/10/2009**, pero es la fuente canónica del `<DD>` a la que el formato v2.5 2026-02 **sigue remitiendo** (la estructura del TED es estable hace ~17 años). Extraído y leído campo a campo con `pdftotext`.
- **Resultado**: el parser `parse-ted-dd.ts` (mergeado en #501) coincide **exactamente** con la estructura oficial. Sin discrepancias. El catálogo `<TD>` no cambió. La distinción emisor/receptor (error clásico) está correcta. Sin cambios de código requeridos.

## Confirmación de vigencia (gate C-7.a)
- Documento de formato vigente del SII: **FORMATO DOCUMENTOS TRIBUTARIOS ELECTRÓNICOS 2026-02, Versión 2.5** — [formato_dte_202602.pdf](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) (confirmado por el PO 2026-06-19; leído del propio PDF, no del índice de búsqueda).
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
10. **Instructivo fechado 2009, TED estable**: el ANEXO 2 está fechado 15/10/2009, pero el formato vigente v2.5 2026-02 **sigue remitiendo a él** para el detalle del timbre — la estructura del `<DD>` no cambió en ~17 años. Validación contra esa fuente = vigente.

## Conclusión del gate C-7 (PR #501)

✅ **C-7 validado contra FORMATO DTE v2.5 2026-02 (confirmado por el PO) + Instructivo Técnico ANEXO 2, sin discrepancias.** El mapeo del parser `parse-ted-dd.ts` coincide tag-por-tag con la fuente oficial; el catálogo `<TD>` no cambió; emisor/receptor correctos; `<FE>` → `fecha_emision` con ancla **estricta** (`CASE WHEN fecha_emision IS NULL`, sin `GREATEST`; `created_at` solo fallback; nunca acortar una retención ya anclada — ver `document-store.ts` y los tests behavioral pglite). **No requirió cambios de código ni de tests** (los tests existentes ya cubren el catálogo `<TD>` y la distinción emisor/receptor).
