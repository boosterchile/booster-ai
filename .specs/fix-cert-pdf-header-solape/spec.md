# fix(cert-pdf): el título ámbar del reporte estimativo pisa "Booster Chile SpA" en el header

**Estado**: aceptada · **Fecha**: 2026-08-16 · **Rama**: `fix/cert-pdf-header-solape` · **Package**: `packages/certificate-generator`

## Problema

En `generar-pdf-base.ts` el header dibuja el título en `x = 40` y la marca "Booster Chile SpA"
(HelveticaBold 12) en `x = width − 180 = 415,28 pt` (A4). El título depende del nivel de
certificación (`render-helpers.ts`):

| Nivel | Título | Tamaño | Fin del título (x) | ¿Pisa la marca (415,28)? |
|---|---|---|---|---|
| `primario_verificable` | CERTIFICADO DE HUELLA DE CARBONO | 18 | 398,6 | no |
| `secundario_modeled` / `secundario_default` | REPORTE ESTIMATIVO DE HUELLA DE CARBONO | 16 | **426,8** | **sí, ~11,5 pt** |

Medido con `PDFFont.widthOfTextAtSize` sobre el mismo font que usa el renderer y verificado en un
PDF renderizado (muestra `A-hoy-reporte-estimativo-BOO-DEMO01.pdf`, sesión 2026-08-16). El
comentario de `tamanoTitulo` declara la intención de "reducir el tamaño para que quepa", pero 16 no
alcanza.

Impacto: hoy `apps/api` nunca produce `exacto_canbus` (ver memoria `demo-readiness-prod-2026-08-16`),
por lo que **todo certificado que emita prod es secundario y sale con el header solapado**.

## Criterio de éxito

1. Existe un test en `packages/certificate-generator` que, con el font real (HelveticaBold vía
   pdf-lib), verifica para los **tres** niveles que
   `x_título + ancho(tituloHeader(nivel), tamanoTitulo(nivel)) + separación_mínima ≤ x_marca`,
   con `separación_mínima ≥ 12 pt`.
2. Ese test **falla en rojo** contra el código actual (exhibido en el PR) y pasa tras el fix.
3. Los invariantes de layout (margen del título, texto y tamaño de la marca, offset de la marca,
   separación mínima) viven en **un solo lugar** (`render-helpers.ts`) que consumen renderer y
   test — sin números mágicos duplicados.
4. `tituloHeader`/`subtituloHeader` no cambian de texto (el copy es parte del mecanismo
   anti-greenwashing de ADR-028; no se toca).
5. Suite completa del package verde, `typecheck` y `biome` verdes, y un PDF secundario renderizado
   sin solape adjunto como evidencia.

## Fuera de alcance

- Cambiar el copy del header o del disclaimer (ADR-028).
- Rediseñar el header (alinear la marca a la derecha por ancho medido es una opción válida pero
  cambia el layout de todos los certs; se elige el cambio mínimo).
- El resto de gaps del PDF (TTW/WTT/intensidad en `null`, ISO 14064 no impresa) — deuda conocida,
  fuera de este fix.

## Enfoque

RED → GREEN → REFACTOR:
1. **RED**: `test/header-layout.test.ts` mide con pdf-lib y asserta la separación para los 3 niveles
   usando los números actuales del renderer (40 / width−180 / 12 pt).
2. **GREEN**: `tamanoTitulo` secundario 16 → 14 (fin del título 378,5 pt; deja 36,8 pt libres).
3. **REFACTOR**: extraer `HEADER_LAYOUT` (+ helper de posición de la marca) a `render-helpers.ts`,
   consumirlo desde `generar-pdf-base.ts` y desde el test. Sin cambio de comportamiento.
