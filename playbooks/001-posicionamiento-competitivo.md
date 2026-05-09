# 001 — Posicionamiento competitivo Chile + LATAM

**Status**: Accepted
**Date**: 2026-05-05
**Decider**: Felipe Vicencio (Product Owner)
**Related**:
- [ADR-009 — Análisis competitivo y diferenciadores](../docs/adr/009-competitive-analysis-and-differentiators.md) (decisión arquitectónica complementaria)
- [Market research 001 — Panorama competitivo](../docs/market-research/001-competidores-chile-latam-2026-q2.md)
- [Market research 002 — Follow-up de acciones](../docs/market-research/002-follow-up-acciones.md)
- [Market research 003 — Feature brief priorizado](../docs/market-research/003-feature-brief-prioridades.md)

---

## Decisión

Booster AI se posiciona en LATAM como **la única plataforma de logística terrestre B2B que cierra el viaje y entrega el certificado IFRS S2 firmado**, monetizando los retornos vacíos como fuente certificable de CO₂ evitado, y aprovechando **alianza directa con Teltonika** (sin reseller) para construir red de oferta defensible.

## Contexto

El research de mayo 2026 (reportes 001/002) cubrió 13+ competidores en tres clusters (marketplaces de matching, telemetría/fleet management, plataformas de carbono). Hallazgo central: **el cuadrante "marketplace + GLEC certificado en LATAM" está vacío**. Tennders (España) lo tiene en beta y restringido a Europa; Carga Inteligente (Chile) y Avancargo (Argentina) reportan métricas de carbono no certificadas; Frete.com (Brasil) tiene métricas genéricas sin metodología publicada.

Simultáneamente, la **NCG 519 de la CMF Chile** (octubre 2024) obliga a las sociedades anónimas abiertas a reportar bajo IFRS S1/S2 desde año fiscal 2026 (publicación 2027). IFRS S2 exige métricas Scope 3 verificables — donde transporte upstream/downstream cae directo. La demanda regulatoria coincide con el timing comercial de Booster.

Adicionalmente, la **alianza directa con Teltonika** (confirmada por el Product Owner el 2026-05-05) habilita programas de hardware-as-a-service que un reseller como BlackGPS no puede igualar sin sacrificar margen — convirtiendo lo que originalmente se proyectaba como partnership en una **competencia frontal en hardware** ganable.

## El playbook

### Posicionamiento de una frase (público / sales)

> "Booster AI es la única plataforma de logística terrestre B2B en LATAM que cierra el viaje y entrega el certificado IFRS S2 — sin que el shipper escriba una línea de cálculo."

### Tres pilares de mensaje

1. **Cumplimos por ti** — el certificado firmado es la entrega; tu equipo Sustainability deja de hacer Excel ni pagar consultoría USD 5-20k/año.
2. **Pagas el viaje real** — sin spread oculto; transparencia de comisión escalonada; el transportista cobra lo justo.
3. **Vivimos en WhatsApp** — el transportista no descarga nada nuevo; tu logística no rompe sus rutinas.

### Segmentos objetivo (priorizados)

| Prioridad | Segmento | Por qué primero |
|---|---|---|
| 1 | S.A. abiertas CMF en retail/CPG (Walmart Chile, Cencosud, Falabella, Embotelladora Andina, CCU) | Mandato NCG 519 directo + ticket alto + visibilidad pública |
| 2 | Minería con compromiso ESG (BHP, Codelco, Antofagasta Minerals, SQM) | Ticket muy alto + presión stakeholders internacionales |
| 3 | Industria forestal/agrícola (Arauco, CMPC, Concha y Toro, Viña San Pedro) | Volumen alto + exportadoras con compradores ESG-sensitive |
| 4 | Empresas medianas (>USD 4M ventas) sin S.A. abierta | Mandato Ley 21.455 + entrada por volumen |
| 5 | Stakeholders ESG (mandantes corporativos pagantes — banca, compliance, auditoría) | Revenue diversificado, fee por acceso a evidencia auditable |

### Anti-posicionamiento (qué NO somos)

- No somos un broker tradicional — no tomamos spread oculto.
- No somos un TMS para flota propia — eso es Drivin, SimpliRoute.
- No somos solo telemetría — eso es BlackGPS.
- No somos solo cálculo de carbono — eso es EcoTransIT, Persefoni, Pledge/Blue Yonder.
- No somos last-mile B2C — eso es Cargamos urbano, 99minutos.
- No somos freight forwarder cross-border — eso es Nowports.

### Roadmap competitivo recomendado (12-24 meses)

| Trimestre | Foco | Razón competitiva |
|---|---|---|
| Q3 2026 | MVP marketplace + carbono `por_defecto` certificable, Chile | Capturar primeros pilots antes que NCG 519 obligue a las S.A. |
| Q3 2026 | Programa Teltonika Direct Onboarding operativo | Bloquear a BlackGPS en lado oferta antes que reaccione |
| Q4 2026 | Modo `exacto_canbus` operativo + certificado PADES firmado KMS | Diferencial técnico vs Carga Inteligente, Avancargo, Liftit |
| Q4 2026 | Reporte IFRS S2 descargable agregado por shipper | Producto vendible al equipo Sustainability del cliente |
| Q1 2027 | Inicio formal SFC Certification process (GLEC) | Antes que ningún competidor LATAM lo intente |
| Q2 2027 | DTE + Carta Porte chilenos integrados end-to-end | Trinchera defensiva vs cualquier entrante extranjero |
| Q3 2027 | Expansión Colombia (cifra 69% empty miles validada por academia) | Sigue regulación ISSB en CO; aprovecha presencia Liftit en contracción |
| Q1 2028 | Piloto con un shipper minero o forestal grande de Chile | Validación de ticket grande antes de Series A |
| Q2 2028 | SFC Certification obtenida (si proceso 6-9 meses se cumplió) | Marca defensiva, marketing dramático con certificación oficial |

### Posicionamiento defensivo frente a competidores específicos

- **vs Tennders (si entra a LATAM via partner local)**: nuestro foco LATAM nativo + DTE + Carta Porte hacen costoso replicar. Acelerar moats locales antes que entren.
- **vs Avancargo (si expande presencia en Chile)**: nuestra certificación GLEC superior + Teltonika directo. Apuntar al segmento ESG-conscious que Avancargo no servirá técnicamente.
- **vs Liftit (CO/CL/MX/EC, en contracción)**: ventana de oportunidad — no atacamos, capturamos los clientes que abandonen su sub-atención digital.
- **vs Carga Inteligente (CL, marketplace volumen + métrica no-certificada)**: nuestro certificado auditable los vuelve obsoletos para el shipper bajo NCG 519. Mensaje: "su métrica no resiste auditoría IFRS S2".
- **vs Fleteretorno (CL, empty-returns + árbol nativo)**: nuestro certificado es métrica real, no símbolo. Mantener su tier 10-15% como benchmark de pricing.
- **vs BlackGPS (CL/CO/PE, telemetría)**: ahora competidor frontal — Teltonika directo nos permite ir abajo en precio + dar marketplace que ellos no tienen.
- **vs Frete.com (BR, unicornio si cruza a hispanoamérica)**: lenta entrada lingüística. Si cruzan, defendemos con doc local CL + certificación SFC.
- **vs M&A (Pledge→BlueYonder, Beetrack→DispatchTrack)**: si recibimos oferta de adquisición temprana, considerar costo de oportunidad vs construir moat propio en LATAM. Negociar desde fortaleza, no desde necesidad.

### KPIs de éxito (12 meses post-launch)

- ≥3 sociedades anónimas abiertas listadas en CMF como clientes pagadores recurrentes.
- ≥1 case study público de reducción CO₂ certificada con un shipper grande.
- ≥USD 500k ARR anualizado.
- 1 partnership IoT firmado o programa Teltonika Direct con ≥100 transportistas onboarded con device subsidiado.
- Marca reconocida en ≥2 publicaciones gremiales (Logistec, Negocios Globales, Diario Financiero).
- Postulación SFC Certification iniciada o aceptada.

## Anti-playbook

Lo que **no** se hace bajo este posicionamiento:

- **No diluir mensaje con features no diferenciales**. Si una feature no cierra un gap del cuadro competitivo del 001, se posterga.
- **No competir en pricing puro contra brokers tradicionales**. Nuestro precio refleja certificación + observabilidad + automatización. Quien quiere lo barato va a Carga Inteligente.
- **No vender a B2C ni last-mile urbano** en los primeros 24 meses. Cargamos pivoteó hacia ahí; nosotros mantenemos B2B carga interurbana.
- **No expandir a Brasil ni Argentina** antes de cerrar Chile + Colombia. Frete.com y Avancargo son competidores fuertes en sus mercados nativos.
- **No comprometernos con compensaciones (offsets) ni REDD**. Nosotros certificamos *reducciones* trazables, no compensaciones nominales.
- **No firmar exclusividades de tecnología que limiten futuras integraciones** (ej. exclusividad con un solo proveedor SII bloquea a otros shippers).

## Métricas de éxito del posicionamiento (cómo sabemos que está funcionando)

Más allá de los KPIs comerciales:

- **Tasa de mención espontánea**: cuando un prospecto describe Booster a un colega, ¿usa la palabra "certificado" o solo "marketplace"? Medir en sales calls.
- **Razón de cierre de deals**: encuesta post-firma — ¿cuál fue el #1 motivo de elegir Booster vs alternativa? Esperamos: certificación auditable / NCG 519 / falta de doc local en alternativas.
- **Time-to-value del certificado**: tiempo desde primer viaje hasta primer reporte IFRS S2 entregado al shipper. Target: <30 días.
- **Churn por feature missing**: si un cliente se va, ¿la razón está en el roadmap competitivo? Si no, requerimos re-spec del posicionamiento.

## Triggers de revisión / superseder

Este playbook se revisa o reemplaza cuando ocurra **cualquiera** de:

- **Trigger regulatorio**: cambia la NCG 519 o se posterga IFRS S2 en Chile.
- **Trigger competitivo grande**: entrada confirmada de Tennders, Frete.com o Uber Freight a Chile.
- **Trigger M&A**: oferta de adquisición seria sobre Booster, o adquisición de un competidor relevante por un player global (ej. SAP compra Avancargo).
- **Trigger pivote**: pivote de producto que cambie el segmento target (ej. mover a B2C urbano).
- **Trigger validación**: las hipótesis H1-H6 del cuestionario de entrevistas a shippers ([002 §6](../docs/market-research/002-follow-up-acciones.md)) refutan ≥3 supuestos del posicionamiento.
- **Trigger de tiempo**: 12 meses desde la fecha de aceptación, revisión obligatoria.

---

**Próximas actualizaciones esperadas**: incorporación de hallazgos del reporte 003 (entrevistas a shippers) cuando esté listo. Esperado Q3 2026.
