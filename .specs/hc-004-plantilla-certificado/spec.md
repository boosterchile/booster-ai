# HC-004 T2 — Plantilla v2 del certificado por viaje

Fuente: `HC-004-T2-plantilla-certificado/{brief,ux,huellachile}.md` y `HC-001/decision.md` (14:41, 14:50, 15:44, 16:03), más las decisiones de Orquestador (17:29).

## Entradas
`DatosMetricasCertificado` y `DatosViajeCertificado` (con `version` opcional: número y versión reemplazada) que arma `emitir-certificado-viaje.ts` desde `metricas_viaje`.

## Salidas
PDF A4 con placeholder PAdES. Se divide en dos PR:
- **PR-A (encabezado y sello):**
  - fila superior con código y «Versión N · reemplaza a vM»;
  - regla azul;
  - título único «Certificado de huella de carbono»;
  - sello ESTIMADO;
  - subtítulo «GLEC Framework {versión} · ISO 14083:2023 · …» con la frase ISO;
  - badge de calidad (`presentacionNivel`);
  - fila de fechas con «—» cuando falta el dato;
  - disclaimer nuevo justo después de Resultados;
  - frase ISO en Metodología;
  - pie «BOO-X · vN · Estimado» y «Página X de Y»;
  - Inter .ttf (OFL) con @pdf-lib/fontkit (MIT), CO₂e con U+2082 y formato es-CL.
- **PR-B (factores, referencia y versión):**
  - línea de factores desde una tabla versionada por `factores_fuente`, opción (d);
  - referencia HuellaChile 2025 (criterios 14 y 15);
  - `glecVersion` sin default 'v3.0' en el emisor ni en la razón de firma.

## Criterios de éxito
Criterios 1 a 15 de ux.md. En PR-A: 1 a 10 (los textos verificados con pdfjs). En PR-B: 7, 11, 12, 13, 14 y 15.
