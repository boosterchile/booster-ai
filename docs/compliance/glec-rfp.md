# RFP — Certificación externa GLEC v3.0 para Booster AI

**Fecha de emisión**: 2026-05-18
**Autor**: Felipe Vicencio (`dev@boosterchile.com`)
**Empresa**: Booster AI (marketplace B2B de logística sostenible Chile)
**Refs internos**: [ADR-021](../adr/021-glec-v3-compliance.md), [ADR-022](../adr/022-emissions-methodology-and-wtw-factor.md), [`packages/carbon-calculator/`](../../packages/carbon-calculator/), `.specs/production-readiness/spec.md` SC-23
**Status global del RFP**: Drafted (pendiente envío PO — ver §"Shortlist y envíos")

---

## 1. Objetivo

Contratar un auditor third-party para emitir una certificación independiente de la metodología de cálculo de huella de carbono de Booster AI, alineada con **GLEC Framework v3.0** (Smart Freight Centre, 2024) y armonizada con **ISO 14064-2** y **GHG Protocol Corporate Accounting Standard** + **Product Standard**.

El certificado emitido alimentará:

- **Producto**: el sello "Carbon Certified by [Auditor]" en cada certificado individual de huella emitido a clientes (shipper / stakeholder ESG).
- **Comercial**: diferenciador defensible vs competencia chilena (Camiongo, CargaRápida, etc. — ver [ADR-009](../adr/009-competitive-analysis-and-differentiators.md)) en el segmento B2B mid-market y stakeholders ESG corporativos.
- **Regulatorio**: respaldo para reportes a auditores ESG corporativos y compliance Ley 21.455 (Chile cambio climático).

---

## 2. Scope del audit

### 2.1 In-scope

| Item | Ubicación en repo | Notas |
|---|---|---|
| Metodología GLEC v3.0 aplicada | `packages/carbon-calculator/src/glec/` + ADR-021 | Empty backhaul allocation, factores TTW/WTT, modal share, ICAO/IATA-style multipliers |
| Factores de emisión | `packages/carbon-calculator/src/factores/` + ADR-022 | TTW diesel/gasolina/GNV/eléctrico, WTT B5 Chile, EV grid mix Chile |
| Lógica de agregación a viaje (trip-level) | `apps/api/src/services/calcular-metricas-viaje.ts` | Distancia (Routes API) + carga (toneladas declaradas) → g CO₂e/t·km |
| Pipeline de datos telemetría → cálculo | `apps/telemetry-processor/src/` + `packages/codec8-parser/` | Validación CAN bus inputs (cuando hay) vs estimación motor (cuando no) |
| Certificado individual emitido al usuario | `packages/certificate-generator/src/` + KMS-signed PDF | Validar contenido + firma + verificabilidad |
| Casos de prueba representativos | `packages/carbon-calculator/test/` + sample dataset (ver §5) | Dataset curado por Booster |

### 2.2 Out-of-scope (este audit)

- Auditoría operacional / data quality de telemetría Teltonika (separado, post-launch comercial).
- Cumplimiento SII Chile (DTE / Guía de despacho / Carta porte) — ya auditado por proveedor Sovos.
- Marketing claims fuera del certificado individual ("offset 100%", "carbon negative", etc.) — no aplican; Booster solo declara medición certificada.
- Análisis de gases distintos a CO₂e (NOx, PM, SOx).

### 2.3 Sample dataset

Booster prepara un dataset representativo de ≥100 viajes con todas las dimensiones relevantes (corredores Norte/Centro/Sur Chile, vehículos liviano/medio/pesado, tipo carga seca/refrigerada/líquida, combustible diesel/GNV/eléctrico, con y sin backhaul). Sample dataset queda disponible 2 semanas post-firma de contrato.

---

## 3. Deliverables esperados

| # | Deliverable | Formato |
|---|---|---|
| 1 | Certificate of Conformity — GLEC v3.0 | PDF con firma digital del auditor + número de registro |
| 2 | Audit Report con findings | PDF estructurado por estándar (GLEC § / ISO 14064-2 § / GHG Protocol §) |
| 3 | Recommendations log | Markdown o PDF, priorizado (Major / Minor / Observation) |
| 4 | Statement of Independence | Carta declarando que el auditor no tiene conflictos de interés con Booster ni proveedores asociados |
| 5 | Sign-off de la metodología publicable | Texto corto licenciado para uso en `www.boosterchile.com` + certificados emitidos |

---

## 4. SLAs esperados

| Métrica | Target |
|---|---|
| Lead time desde firma de contrato hasta entrega certificado | **≤ 8 semanas** (preferible 6) |
| Lead time desde envío sample dataset hasta primera ronda de findings | ≤ 3 semanas |
| Rondas de respuesta a findings incluidas en el alcance | ≥ 2 (Major findings) |
| Validez del certificado | Mínimo 12 meses, con opción de re-certificación anual |
| Confidencialidad | NDA mutuo firmado pre-acceso a código + dataset |
| Idioma deliverable | Inglés (preferible) o español |

---

## 5. Estructura comercial esperada

- **Pricing**: fee fijo all-inclusive preferido. Si fee + variable, declarar variables (extra rounds, extensión de scope, etc.).
- **Pago**: 30% al kickoff / 40% al primer draft de report / 30% post-emisión del certificado.
- **Rango referencia mercado** (esperado): USD 8 000 – USD 25 000 para alcance descrito. Si la propuesta excede este rango, justificar.
- **Forma de contratación**: contrato estándar del vendor, revisado por abogado de Booster. Jurisdicción preferida Chile o internacional reconocida (UK/NL/CH).

---

## 6. Timeline objetivo

| Hito | Fecha objetivo |
|---|---|
| RFP enviado a shortlist | **Semana de 2026-05-19** (PO send) |
| Respuestas de vendors recibidas | Semana de 2026-06-02 (≤ 2 sem) |
| Selección + contrato firmado | Semana de 2026-06-16 (≤ 4 sem desde envío) |
| Sample dataset entregado al vendor | Semana de 2026-06-30 (post-firma) |
| Primera ronda de findings recibida | Semana de 2026-07-21 (≤ 3 sem post-dataset) |
| Certificado emitido | **Semana de 2026-09-01** (≤ 8 sem post-firma) |

Timeline está sujeto a respuesta de los auditores; cualquier slippage se documenta en `docs/compliance/` con racional.

---

## 7. Shortlist y envíos

> **Estado**: shortlist redactada por el agente; los envíos por email a cada vendor son acción del PO (Felipe). Esta sección se actualiza con fecha + status real post-envío.

| Vendor | Contacto sugerido | Presencia Chile | Capacidades relevantes | Status | Fecha envío | Respuesta |
|---|---|---|---|---|---|---|
| **SGS Chile** | https://www.sgs.cl/es-es/contactenos | ✅ Oficinas Santiago | ISO 14064-1/-2/-3, GHG Protocol verification, certificaciones de productos | Drafted-pending-PO-send | TBD | TBD |
| **Bureau Veritas Chile** | https://www.bureauveritas.cl/contacto | ✅ Oficinas Santiago + Concepción | ISO 14064-2, GHG Protocol, sustainability reporting assurance | Drafted-pending-PO-send | TBD | TBD |
| **DNV LATAM** | https://www.dnv.com.br/contact/index.html | ⚠️ Oficinas Brasil/Argentina (servicio remoto Chile estándar) | ISO 14064, GHG Protocol, GLEC-aware (member of Smart Freight Centre network) | Drafted-pending-PO-send | TBD | TBD |

### 7.1 Criterios de selección de la shortlist

- **Acreditación**: el auditor debe estar acreditado por un organismo IAF/ILAC reconocido para emitir certificaciones ISO 14064.
- **Familiaridad con GLEC**: idealmente miembro/partner de Smart Freight Centre (SFC). Si no, demostrar experiencia previa con clientes de transporte/logística.
- **Presencia LATAM**: oficinas o representante en Chile/región; remoto puro aceptable solo si el resto del fit es excelente.
- **Footprint Booster-relevante**: clientes previos en transporte, logística B2B, o marketplace digital. Bonus si auditaron alguna otra plataforma con telemetría IoT.

### 7.2 Mensaje template para envío PO

Texto sugerido para que el PO copie/edite al enviar (asunto + cuerpo):

```
Asunto: RFP — Certificación GLEC v3.0 para marketplace de logística sostenible Chile

Buenos días,

Mi nombre es Felipe Vicencio, fundador de Booster AI — un marketplace B2B
de logística sostenible que opera en Chile certificando huella de carbono
de cada viaje de transporte de carga.

Estamos evaluando un audit independiente de nuestra metodología de cálculo
GLEC v3.0 / GHG Protocol / ISO 14064-2. Adjunto RFP con scope, deliverables
esperados, SLAs, timeline y estructura comercial.

Quedo atento a:
- Confirmación de fit con su práctica.
- Propuesta preliminar (precio + timeline).
- Cualquier pregunta sobre el scope.

Gracias,
Felipe Vicencio
Booster AI · dev@boosterchile.com · +56 ...
[Link al RFP en GitHub público o adjunto PDF si se prefiere]
```

### 7.3 Tracking post-envío

Después del envío real, esta tabla se actualiza con:
- `Status: Sent` + fecha real.
- `Respuesta`: Pending → Received YYYY-MM-DD (link a thread / archivo de propuesta en `.private/glec-rfp-responses/`).
- Decisión final + razón (selected / declined / no-response).

Si alguno de los 3 vendors no responde en 2 semanas, ampliar shortlist (candidatos backup: AENOR Chile, TÜV Rheinland Chile, Smart Freight Centre direct via SFC member network).

---

## 8. Anexos referenciados

- **ADR-021** — GLEC v3.0 compliance + empty backhaul como diferenciador.
- **ADR-022** — Methodology and WTW factor.
- **`docs/research/013-glec-audit.md`** — Audit interno que motivó la metodología actual.
- **`packages/carbon-calculator/src/glec/`** — Implementación de GLEC en código.
- **`packages/carbon-calculator/src/factores/`** — Factores de emisión (TTW/WTT) con citas a IPCC AR6 / DEFRA UK / GLEC EU.
- **`packages/carbon-calculator/test/`** — Test cases unitarios con valores esperados.

---

## 9. Decision log

- **2026-05-18** — Initial draft (Sprint S0 T6). Shortlist inicial: SGS Chile, Bureau Veritas Chile, DNV LATAM. Envíos pendientes acción PO.
