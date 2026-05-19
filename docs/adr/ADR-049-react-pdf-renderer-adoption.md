# ADR-049: Selección de Librería de Generación PDF \+ Remoción de `pdf-lib`

- **Fecha**: 2026-05-19  
- **Status**: Accepted  
- **Decisores**: Felipe Vicencio (PO)  
- **Tags**: pdf, dependencies, compliance, dte, carta-porte, sprint-2

---

## Contexto y problema

La auditoría arquitectónica 2026-05-19 (sesión `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`, ver ADR-054 / PR \#303) identificó **R-016** documentado en `audit-outputs/02_DEPENDENCIES.md`:

`pdf-lib` declarado como dependencia, sin commits hace 4 años en el repositorio upstream.

El análisis empírico posterior reveló un dato más fuerte que el reportado en la auditoría:

```shell
$ grep -rnE "pdf-lib|from 'pdf-lib'" apps --include="*.ts" --include="*.tsx"
apps/api/tsup.config.ts:55:    'pdf-lib',
```

**`pdf-lib` está declarado en `apps/api/package.json` \+ listado como external en `tsup.config.ts`, pero tiene cero imports en código de aplicación.** Es **deuda silenciosa** del mismo patrón que **R-001 OTel** — dependencia preparada para uso futuro que nunca se materializó.

### Implicación clave

Esto **no es una migración**. Es:

1. Una decisión de adopción **greenfield** para la lib de generación PDF.  
2. Una **limpieza** de la deuda silenciosa (`pdf-lib` debe removerse).

### Stack de firma PDF ya configurado (no requiere decisión)

El repo tiene como externals en `tsup.config.ts`:

```javascript
'@signpdf/utils',
'node-forge',
'pdf-lib',  // ← deuda
```

`@signpdf/utils` es el ecosystem moderno de firma PDF (reemplaza al deprecated `node-signpdf`). `node-forge` provee criptografía para los certificados. **Este stack es agnóstico al generador PDF** — funciona con cualquier PDF binary que se le pase como input.

Esto significa que la decisión actual afecta **solo al generador**, no al flujo de firma.

### Casos de uso planificados

- **DTE SII**: Documentos Tributarios Electrónicos (boletas, facturas electrónicas).  
- **Carta Porte Ley 18.290**: Documentos de transporte regulados.  
- **Reportes operacionales** (futuro): emisiones GLEC, comprobantes de operación.

Caracteristicas comunes:

- Estructura con datos dinámicos (tablas, campos, totales).  
- Sin diseño visual altamente personalizado.  
- Requieren firma digital con certificado SII / persona jurídica.  
- Retención **6 años** (estabilidad de la lib es crítica).

---

## Decisión

Adoptar **`@react-pdf/renderer`** como librería única para generación PDF en `apps/api`, removiendo `pdf-lib`.

### 1\. Remoción de `pdf-lib`

- Eliminar entry `"pdf-lib": "^1.17.1"` de `apps/api/package.json`.  
- Eliminar `'pdf-lib'` de la lista de externals en `apps/api/tsup.config.ts`.  
- Ejecutar `pnpm install` para actualizar `pnpm-lock.yaml`.

### 2\. Adopción de `@react-pdf/renderer`

- Agregar `"@react-pdf/renderer": "^4.x.x"` a `apps/api/package.json` (versión actual al momento del PR).  
- Agregar `'@react-pdf/renderer'` a externals de `tsup.config.ts` (el bundle puede ser pesado, mejor cargar en runtime).  
- Tipos integrados (no requiere `@types/...`).

### 3\. Crear `packages/pdf-templates/` como package del monorepo

Estructura propuesta:

```
packages/pdf-templates/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    (re-exports públicos)
│   ├── components/                 (átomos compartidos)
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   ├── DataRow.tsx
│   │   └── SignatureBlock.tsx
│   ├── templates/                  (templates concretos)
│   │   ├── DTEBoletaTemplate.tsx
│   │   ├── DTEFacturaTemplate.tsx
│   │   └── CartaPorteTemplate.tsx
│   └── types/
│       ├── DTEData.ts
│       └── CartaPorteData.ts
└── test/
    └── fixtures/                   (JSON con data de ejemplo)
```

**Beneficios del package separado**:

- Componentes reutilizables entre tipos de documento (DTE Boleta, DTE Factura comparten Header/Footer).  
- Tipos compartidos con `apps/api` y `apps/web` (preview futuro en frontend).  
- Versionado independiente del API si se requiere.  
- Tests unitarios aislados con fixtures JSON.

### 4\. Integración con flujo de firma

Pipeline:

```
Data de aplicación
  ↓
Template React (packages/pdf-templates)
  ↓ ReactPDF.renderToBuffer(<Template data={data} />)
PDF Buffer (sin firmar)
  ↓ @signpdf/utils + node-forge
PDF Buffer firmado
  ↓ upload Cloud Storage / response al cliente
PDF final
```

**Separación de concerns** explícita: generación → firma. Cada etapa tiene su test unitario.

### 5\. Primer template como Proof of Concept

Implementar **DTE Boleta** como primer template completo:

- Fixture JSON con datos de boleta de prueba.  
- Componente `DTEBoletaTemplate.tsx` con header, datos del emisor/receptor, líneas de detalle, totales.  
- Test que renderiza, firma con cert de prueba, valida PDF resultante con `@signpdf/verifier`.

Una vez validado el PoC end-to-end, los demás templates (Factura, Carta Porte) son extensiones del patrón.

---

## Consecuencias

### Positivas

- **Cero deuda residual** de `pdf-lib` en el repo.  
- Stack React-first consistente (apps/web usa React, packages/pdf-templates también).  
- **Componentes tipados reutilizables** entre tipos de documento.  
- Bundle aceptable (\~10-15MB) para Cloud Run sin penalizar cold starts.  
- Sin headless browser (descarta puppeteer/playwright como alternativas innecesarias).  
- Tipado fuerte vía TypeScript en templates y data structures.  
- Mantenido activamente: `@react-pdf/renderer` tiene releases recientes y comunidad activa.  
- Preview futuro en `apps/web`: la misma library puede renderizar a canvas en browser para preview antes de generar el PDF final del backend.

### Negativas

- Subset de CSS limitado en `@react-pdf/renderer` (no soporta CSS3 completo, sin flexbox de últimas specs).  
- Curva de aprendizaje inicial: layout en React-PDF difiere ligeramente de React-DOM.  
- Dependencia community-maintained (no enterprise SLA). Mitigación: monitoring de health del repo upstream \+ fork si fuera necesario.

### Riesgos

- **Si la comunidad de `@react-pdf/renderer` se estanca**, se replica el problema de `pdf-lib`. Mitigación: monitorear el repo cada 6 meses; alternativas activas existen (`pdfkit` como fallback de rescate, aunque requeriría reescritura).  
- **Performance para PDFs muy largos** (\>100 páginas). Mitigación: ninguno de los casos de uso planificados (DTE, Carta Porte, reportes) supera 5 páginas típicas. Si en el futuro se necesita, evaluar `streaming render` con la propia lib.

### Trabajo futuro

- Preview de templates en `apps/web` con `@react-pdf/renderer/dist/react-pdf.browser.es.js` (canvas rendering).  
- CI gate que detecte uso de libs PDF no aprobadas (lint rule custom: prohibir imports de `pdf-lib`, `jspdf`, etc.).  
- Eventual paquete `packages/pdf-signer/` que abstraiga la firma signpdf si el código de firma crece.

---

## Plan de implementación

| Fase | Tarea | Estimación | Owner | Bloqueante |
| :---- | :---- | :---- | :---- | :---- |
| 1 | Remover `pdf-lib` de `apps/api/package.json` \+ `tsup.config.ts` \+ `pnpm install` | 0.5d | TBD | Ninguno |
| 2 | Instalar `@react-pdf/renderer` \+ agregar a externals tsup | 0.5d | TBD | Fase 1 |
| 3 | Bootstrap de `packages/pdf-templates/` (estructura, tsconfig, package.json, primer index.ts) | 1d | TBD | Fase 2 |
| 4 | Implementar componentes base (`Header`, `Footer`, `DataRow`, `SignatureBlock`) | 1d | TBD | Fase 3 |
| 5 | Implementar primer template `DTEBoletaTemplate.tsx` \+ fixture JSON | 2d | TBD | Fase 4 |
| 6 | Integración con signpdf (función helper `signPDF(buffer, cert)`) | 1d | TBD | Fase 5 |
| 7 | Tests E2E con fixture \+ verificación con `@signpdf/verifier` | 1d | TBD | Fase 6 |

**Total esfuerzo directo**: \~6-7 días.

**Sprint**: Sprint 2 (después de Sprint 1 ejecutivo del ADR-050).

**Files afectados (creación)**:

- `packages/pdf-templates/` (todo el package, \~12-15 archivos).

**Files afectados (modificación)**:

- `apps/api/package.json`  
- `apps/api/tsup.config.ts`  
- `pnpm-lock.yaml`  
- `pnpm-workspace.yaml` (si se requiere registrar el nuevo package)

---

## Alternativas consideradas

### Alternativa A: `pdfkit`

- **Considerada y rechazada por preferencia React-first del PO**.  
- Pros: lightweight (\~2MB), maintained, API imperativa simple, cold starts más rápidos.  
- Contras: requiere reimplementar componentes desde cero en API imperativa, sin reutilización con código React del frontend.  
- Veredicto: viable como fallback de rescate si `@react-pdf/renderer` se estanca.

### Alternativa C: `puppeteer + @sparticuz/chromium`

- **Rechazada por sobre-ingeniería para el caso de uso**.  
- Pros: renderiza HTML/CSS completo (full Chrome engine).  
- Contras: bundle \~50MB, cold starts 2-5s en Cloud Run, memoria 512MB-1GB requerida, costo operativo alto. `chrome-aws-lambda` deprecado; el fork `@sparticuz/chromium` tiene incertidumbre de mantención long-term.  
- Veredicto: justificable solo si surgiera necesidad de documentos con diseño web complejo (charts visuales en reportes, etc.). No aplica a DTE/Carta Porte.

### Alternativa D: `playwright + pdf`

- **Rechazada por sobre-ingeniería para el caso de uso**.  
- Similares trade-offs a Alternativa C. API más moderna que puppeteer pero mismos issues de bundle/cold start.

### Alternativa E: Mantener `pdf-lib`

- **Rechazada**: 4 años sin commits en upstream es regresión activa. Riesgo de vulnerabilidad sin patch \+ ausencia de soporte para features modernas (signed forms, etc.). Cumplir 6 años de retención con dependencia abandonada es contradictorio con el principio "Seguridad por defecto" §7.

### Alternativa F: Implementación propia de PDF generation

- **Rechazada categóricamente**. PDF spec es \~1000 páginas; reinventar es sobre-engineering catastrófico. Solo válido para necesidades muy específicas que ninguna lib cubre.

---

## Referencias

- `audit-outputs/02_DEPENDENCIES.md` (R-016)  
- `audit-outputs/06_REFACTOR_PRIORITIES.md`  
- `CLAUDE.md` §7 Seguridad por defecto, §3 Process over knowledge  
- ADR-050 (observabilidad, PR \#305)  
- ADR-053 (security headers, PR \#306)  
- ADR-054 (Arquitecto Maestro, PR \#303)  
- PR \#304 (skill activation)  
- [@react-pdf/renderer docs](https://react-pdf.org/)  
- [signpdf ecosystem (`@signpdf/utils`)](https://github.com/vbuch/node-signpdf)  
- [SII Chile — Documentos Tributarios Electrónicos](https://www.sii.cl/factura_electronica/)  
- [Ley 18.290 — Carta Porte](https://www.bcn.cl/leychile/navegar?idNorma=29708)

