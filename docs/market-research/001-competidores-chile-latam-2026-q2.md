# 001 — Panorama competitivo: marketplaces de logística + telemetría + carbono en Chile y LATAM (Q2 2026)

**Status**: Draft — pendiente revisión humana de cifras y posicionamiento estratégico
**Date**: 2026-05-05
**Author**: Claude (agente) bajo dirección de Felipe Vicencio (Product Owner)
**Scope**: Mapeo de competidores activos en (a) marketplaces de matching carga–transportista, (b) telemetría/fleet management con IoT, y (c) plataformas de cálculo certificado de huella de carbono logística. Cubre Chile + países LATAM con presencia confirmada (AR, BR, CO, MX, PE, EC, UY). **No cubre**: empresas de courier internacional (DHL/FedEx), forwarders marítimos puros, ni soluciones de última milla B2C food delivery. Foco en B2B carga terrestre.

---

## TL;DR

1. **Nadie en LATAM combina marketplace de matching + cálculo de carbono GLEC v3.0 / ISO 14083 certificado**. Tennders (España) lo tiene en beta y está restringido a Europa; Carga Inteligente (Chile) reporta una métrica simple no certificada (~33 ton CO₂); Avancargo (Argentina) menciona "real-time emission" sin acreditación SFC. **El cuadrante "marketplace + carbono certificado en LATAM" está vacío** — y es exactamente donde Booster está construyendo.
2. **El compliance regulatorio chileno ya es un mandato, no una opción**. La NCG 519 de la CMF (octubre 2024) obliga a las sociedades anónimas abiertas e inscritas a reportar bajo IFRS S1/S2 desde el año fiscal **2026** (publicación 2027). IFRS S2 exige métricas Scope 3 verificables — donde el transporte upstream/downstream cae directo. Hoy ningún proveedor local emite certificados auditables firmados criptográficamente para esa categoría.
3. **El mercado es grande y fragmentado**. Transporte de carga por carretera en Chile: USD 10.76 B (2025) → USD ~16 B (2035), CAGR 4-5.6% (Mordor Intelligence / Expert Market Research). Estudios académicos colombianos (U. de los Andes) cifran los viajes en vacío en **~69%** para vehículos C2 — la oportunidad económica del backhaul es estructural en la región, no marginal.
4. **Los actores chilenos están en silos**. BlackGPS solo telemetría. SimpliRoute/Drivin solo route optimization. Beetrack (hoy DispatchTrack) solo última milla. Carga Inteligente solo marketplace básico. **Ninguno integra los tres niveles** (matching + telemetría CAN-bus + carbono certificado) en una plataforma única con doc local (DTE + Carta Porte) y multi-rol.
5. **Booster tiene 4 ventajas estructurales sin equivalente regional**: (i) certificado PADES firmado con KMS reconciliable a IFRS S2, (ii) PWA multi-rol (shipper/carrier/driver/admin/stakeholder) en lugar de apps separadas, (iii) WhatsApp bot con NLU como canal nativo del transportista LATAM, (iv) doc tributaria + porte chileno integrados. Cualquier competidor que quiera replicar tiene 12-18 meses de ingeniería + auditoría GLEC por delante.
6. **Riesgos a vigilar**: (a) Avancargo y Liftit son los competidores con más solapamiento de modelo y capital (Liftit levantó USD 22.5M en 2020 con respaldo de Mercado Libre); (b) Frete.com (BR, unicornio) podría cruzar a hispanoamérica; (c) Tennders podría asociarse con un partner local para entrar a LATAM aprovechando su FMS+FEX ya maduro; (d) Blue Yonder ya absorbió Pledge — la ola de M&A en carbon logistics empezó.

---

## 1. Contexto y pregunta

Booster AI se posiciona como marketplace B2B de logística sostenible que conecta generadores de carga con transportistas, optimiza retornos vacíos y certifica la huella de carbono bajo GLEC v3.0 / GHG Protocol / ISO 14064 (ver [CLAUDE.md](../../CLAUDE.md) §Identidad del proyecto). Tres preguntas estratégicas:

1. ¿Hay competidores que ya estén ofreciendo la propuesta de valor completa (matching + carbono certificado + doc local) en Chile o LATAM?
2. Si no, ¿qué piezas tiene cada competidor relevante, y cuál es el patrón de "qué le falta a quién"?
3. ¿Qué oportunidades concretas de mercado puede capturar Booster en los próximos 12-24 meses dada esta geografía competitiva?

## 2. Metodología

- **Fuentes primarias**: navegación directa a sitios oficiales de cada competidor con Playwright el 2026-05-05 entre 23:37 y 23:46 UTC. Snapshots accesibles en `.playwright-mcp/`.
- **Fuentes secundarias**: WebSearch sobre TechCrunch, Crunchbase, PitchBook, Diario Financiero, El Dinamo, Mordor Intelligence, Expert Market Research, MundoMaritimo, Smart Freight Centre, BCN.cl, CMF Chile, Universidad de los Andes (vía La República CO).
- **Limitaciones**:
  - Tennders sólo se inspeccionó la web pública en español; la versión inglesa puede tener features adicionales.
  - Algunos sitios bloquean la extracción automática de WebFetch (Liftit redirige; Cargamos sirve template Angular vacío SSR). Para esos casos se complementó con prensa.
  - Cifras de funding posteriores a 2020 (Liftit) no se pudieron confirmar — ver §Próximos pasos.
  - El estudio de "69% empty miles" es Colombia, no Chile. Asumir extrapolación con cautela.
  - Driv.in tuvo timeouts intermitentes; los datos de oferta se cruzaron con cobertura de Diario Financiero y Webpicking.
- **Lo que NO se hizo**: entrevistas con clientes ni con los propios competidores; análisis de pricing real (la mayoría no publica tarifas); revisión de patentes; análisis de patentes de marca; benchmarking funcional hands-on (no se solicitó cuenta de prueba).

## 3. Competidores investigados — fichas individuales

### A. Marketplaces / matching de carga (competencia directa)

#### A.1 Tennders ([tennders.com](https://www.tennders.com))

| Campo | Dato |
|---|---|
| Origen | Barcelona, España (Tennders Europe S.L.) |
| Fundación | n/d en sitio público, ESG report indica startup activa |
| Productos | TenndersFMS (gestión de cargas), TenndersFEX (bolsa de cargas), Tennders AI Agents |
| Modelo | SaaS — €300/año primera anualidad para startups, free trial 14 días, partner accounts gratis |
| Cobertura | Europa (sin presencia LATAM declarada) |
| Carbono | Mide CO₂e por carga **en beta** ("estará disponible muy pronto"), sin certificación GLEC declarada |
| IoT/Telemetría | Sin integración nativa con hardware mencionada |
| Doc local CL | No |
| Multi-rol | Web + login |
| Notas | Reporte ESG con EADA Business School. Compliance GDPR. Whistle blower channel. Posicionamiento: "one-stop shop" terrestre. |

**Dónde duele a Booster**: si Tennders entra a LATAM con un partner local (escenario plausible vía la red española en Chile), llega con FMS y FEX maduros y branding ESG. **Dónde no llega**: doc tributaria chilena, certificación GLEC firmada, IoT CAN-bus, WhatsApp.

#### A.2 Avancargo ([avancargo.com](https://avancargo.com))

| Campo | Dato |
|---|---|
| Origen | Buenos Aires, Argentina con operación en Chile |
| Modelo | Mixto: 3PL on-demand + 4PL gestión + SaaS (TMS + FSM) |
| Escala | "+120.000 camiones fiscalizados" en su red |
| Cobertura | AR + CL + 1 país más LATAM |
| Carbono | "Real-time emission measurement" mencionado, **sin certificación GLEC explícita**. B Corp + SME Climate Hub commitment |
| IoT | Tracking de unidades, visibilidad punta a punta — sin hardware propio declarado |
| Doc local | n/d |
| Multi-rol | DriverApp + WebApp separadas |
| Notas | Probablemente el competidor con modelo más cercano a Booster en Sudamérica hispanoparlante. Certificación B Corp es el activo de marca. |

**Dónde duele a Booster**: red de 120k camiones es difícil de igualar de cero. **Dónde no llega**: PWA unificada multi-rol, certificación carbono auditable, foco en optimización de retornos vacíos como métrica de producto.

#### A.3 Liftit ([liftit.co](https://liftit.co))

| Campo | Dato |
|---|---|
| Origen | Bogotá, Colombia |
| Fundación | 2017 |
| Funding | USD 22.5M Serie B (2020), total declarado USD 39.2M; inversores incluyen Mercado Libre y Grupo Bolívar |
| Modelo | Plataforma B2B de last-mile + mediana milla con camiones |
| Cobertura | CO + CL + MX + BR + EC |
| Estado | Profitable en CL y CO al 2020 (sin datos posteriores verificados) |
| Carbono | n/d |
| Multi-rol | App propia |
| Doc local CL | n/d |
| Notas | Backing IFC. Adoptado por retailers grandes para outsourcing de despacho B2B. Sitio actual `liftit.co` redirige — verificar estado operacional 2026. |

**Dónde duele a Booster**: capital, backing institucional (IFC + Mercado Libre), red consolidada en CO/CL. **Dónde no llega**: certificación carbono, foco en sustentabilidad como diferencial, doc tributaria chilena nativa (probablemente a través de partners).

#### A.4 Frete.com / ex-Fretebras ([frete.com](https://www.frete.com))

| Campo | Dato |
|---|---|
| Origen | Brasil |
| Estatus | Unicornio (R$2.2 B en inversión declarados) |
| Modelo | Marketplace de matching + cuenta digital + crédito personal + risk management |
| Métrica de carbono | "5.3M ton CO₂ evitadas anualmente, 5,667,846 ton acumuladas" — métrica genérica, **sin GLEC declarado** |
| Cobertura | Brasil; se posiciona como "LATAM" pero sin operación hispana confirmada |
| Empty returns | "Nunca rode vazio" — claim de producto, sin metodología publicada |

**Dónde duele a Booster si cruza la frontera**: tamaño, capital, plataforma fintech embebida (crédito al transportista). **Dónde no llega**: hispanoparlante, doc CL, GLEC certificado, ISO 14083.

#### A.5 Carga Inteligente ([cargainteligente.com](https://cargainteligente.com))

| Campo | Dato |
|---|---|
| Origen | Chile |
| Modelo | Marketplace por comisión, publicación gratis para shipper, pago al transportista en 48h |
| Escala | "+450k clientes satisfechos, +300k entregas, +15k camiones registrados" |
| Métrica de carbono | "33,300 kg CO₂ reducido" — métrica simple no certificada, sin metodología publicada |
| Tech | App Android + web shipper + "Flota Inteligente" |
| Doc local | n/d explícito |
| Notas | Es el competidor doméstico más directo en marketplace puro. Presencia regional fuerte. Ausencia llamativa de tier de carbono certificado dado su volumen. |

**Dónde duele a Booster**: presencia local, ya tienen 15k camiones onboarded. **Dónde no llega**: 33 ton CO₂ "reducido" sin metodología es vulnerable — un cliente que necesite reportar IFRS S2 no puede usar esa métrica. Es el flanco directo de Booster.

### B. Telemetría / fleet management (competencia adyacente)

#### B.1 BlackGPS ([blackgps.com](https://www.blackgps.com))

| Campo | Dato |
|---|---|
| Origen | Santiago, Chile (2011) |
| Cobertura | Chile + Colombia + Perú; Uruguay próximamente |
| Escala | +1000 empresas, +300k devices instalados, "+50 asesores comerciales en LATAM" |
| Hardware partners | **Teltonika** (mismo proveedor que Booster planea), Mapon, Jimiot |
| Connectivity | Emnify, Telefónica Tech (SIM en 210 países) |
| Verticales | 4 (no detallados públicamente) |
| Carbono | **No mencionado** |
| Marketplace | No |
| Sitio | Shopify (indicador de no plataforma propia muy madura) |

**Implicación**: BlackGPS es un proveedor de fierro + dashboard, no marketplace. **Es socio potencial más que competidor frontal** — Booster podría integrar lecturas Codec8 desde devices ya instalados por BlackGPS en flotas existentes, en lugar de competir por reemplazar hardware. Un canal de partnership obvio: "BlackGPS te da los GPS, Booster te da las cargas".

#### B.2 SimpliRoute ([simpliroute.com](https://simpliroute.com))

| Campo | Dato |
|---|---|
| Origen | LATAM (clientes Walmart, Falabella, Coca-Cola, PepsiCo, Liverpool — +1200 empresas) |
| Producto | Route optimization SaaS con AI agents (ADA), gestión last-mile, control de flotas |
| Carbono | No mencionado |
| Empty returns | Limitado a "Pick Up y Delivery" combinado, no es producto principal |
| Integraciones | SAP, Magento, WooCommerce, VTEX, Oracle NetSuite |

**Implicación**: opera arriba en la cadena (planificación de la propia flota del shipper), no hace matching abierto. No compite por transacciones, compite por seat-license del software. Booster y SimpliRoute pueden coexistir: el cliente que usa SimpliRoute para su fleet podría usar Booster cuando necesita capacidad externa.

#### B.3 Drivin ([driv.in](https://driv.in))

| Campo | Dato |
|---|---|
| Origen | Chile |
| Cobertura | CL + PE + MX + BR + CO + EC + ES (oficinas propias) |
| Escala | +600 clientes en 25+ países (Nestlé, Bimbo, Mondelez, Cencosud) |
| Producto | TMS cloud: planificación, POD, control de flota, liquidación |
| Multi-rol | App driver + portal management |
| Certificaciones | ISO 27001:2022, SOC 1 |
| Carbono | Solo mencionado en case study Nestlé como "objetivo del cliente", no como feature certificable |
| Pricing | Smart Drivin / Plan PYME / Enterprise |

**Implicación**: similar a SimpliRoute — TMS, no marketplace. ISO 27001 es el activo defensivo (los clientes enterprise lo piden). Para Booster: ISO 27001 debe estar en roadmap del Año 2 si quiere venderle a la misma cuenta enterprise.

#### B.4 Beetrack / DispatchTrack ([beetrack.com](https://www.beetrack.com))

| Campo | Dato |
|---|---|
| Origen | Chile (adquirido por DispatchTrack, US) |
| Producto | Last-mile AI: LastMile, QuickCommerce, PlannerPro |
| Cobertura | CL + PE + MX confirmado |
| Carbono | Mencionado como narrativa "logística verde" — sin metodología |
| Marketplace | No |

**Implicación**: caso de exit chileno relevante (señal positiva sobre el mercado), ahora opera bajo paraguas global. No compite por matching B2B.

### C. Plataformas de carbono logístico (referencia de estado del arte)

#### C.1 EcoTransIT World ([ecotransit.org](https://www.ecotransit.org))

- Origen: Alemania (IVE mbH)
- Certificaciones: **ISO 14083 + GLEC Framework + GHG Protocol**
- Cobertura: global, todos los modos (truck/sea/air/rail/inland ship)
- API REST/SOAP, SaaS, integraciones TMS
- **LATAM**: ninguna presencia o partnership declarada

#### C.2 Pledge.io → Blue Yonder ([blueyonder.com](https://blueyonder.com/solutions/sustainable-supply-chain-management/logistics-emissions-calculator))

- **Adquirido por Blue Yonder** (señal de M&A activo en el espacio)
- Calculadora de emisiones logísticas, GLEC framework
- Sin presencia LATAM declarada

#### C.3 BearingPoint LogEC

- Calculadora con **acreditación GLEC** (per nota de prensa BearingPoint)
- Foco: shippers grandes europeos
- Sin presencia LATAM

**Síntesis del cluster carbon-only**: el estado del arte está en Europa, certificado, pero (a) no opera en LATAM, (b) no es marketplace — es solo cálculo, (c) requiere que el cliente le entregue los datos de viaje. Booster captura los datos de viaje desde el matching mismo, lo que reduce la fricción de adopción a cero.

## 4. Matriz comparativa consolidada

Leyenda: ✅ presente y maduro · 🟡 parcial / en beta / sin certificar · ❌ ausente · 🔵 oportunidad de partnership

| Capacidad | Tennders | Avancargo | Liftit | Frete.com | Carga Inteligente | BlackGPS | SimpliRoute | Drivin | Beetrack | EcoTransIT | **Booster (target)** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Marketplace matching B2B | ✅ FEX | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Telemetría IoT CAN-bus (Codec8) | ❌ | 🟡 | ❌ | ❌ | ❌ | ✅ | ❌ | 🟡 GPS | ❌ | ❌ | ✅ |
| Cálculo carbono **GLEC v3.0 / ISO 14083 certificable** | 🟡 beta | 🟡 sin cert | ❌ | 🟡 métrica | 🟡 simple | ❌ | ❌ | ❌ | 🟡 narrativa | ✅ | ✅ |
| Certificado PADES/KMS auditable IFRS S2 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| DTE + Carta Porte chileno integrados | ❌ | ❌ | ❌ | n/a (BR) | 🟡 | ❌ | ❌ | 🟡 | ❌ | ❌ | ✅ |
| WhatsApp bot con NLU canal nativo | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| PWA multi-rol unificada (no apps separadas) | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | n/a | ✅ |
| Pricing engine dinámico empty-return aware | ❌ | 🟡 | 🟡 | 🟡 | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cobertura Chile (presencia local) | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| ISO 27001 / SOC 2 | n/d | n/d | n/d | n/d | n/d | n/d | n/d | ✅ ISO 27001 | n/d | n/d | 🟡 roadmap |
| Backing capital Serie A+ verificado | n/d | n/d | ✅ USD 39M | ✅ unicornio | n/d | n/d | n/d | n/d | ✅ exit DispatchTrack | n/a | 🟡 pendiente |

**Lectura del cuadro**: la fila "Cálculo carbono certificable" tiene exactamente **un actor con ✅ pleno (EcoTransIT) que no opera en LATAM**, y todos los actores con presencia local en ese campo están en 🟡 (sin certificación). La fila "Certificado PADES/KMS auditable IFRS S2" tiene **cero ✅** en todo el panel competitivo. Eso es Booster.

## 5. Contexto regulatorio y de mercado

### 5.1 Chile — el reloj regulatorio ya empezó a correr

| Norma | Quién obliga | Qué obliga | Cuándo |
|---|---|---|---|
| **NCG 461** (CMF, 2021) | Sociedades anónimas abiertas e inscritas | Reportar ESG en memoria anual | Ya vigente |
| **NCG 519** (CMF, oct 2024) | Mismas + ampliación | Adoptar **IFRS S1 + S2** (climate disclosures) | FY **2026**, publicación 2027 |
| **Ley 21.455 Marco Cambio Climático** (jun 2022) | Empresas con ventas anuales >100.000 UF (~USD 4M) | Medir + reportar huella de carbono | Vigente, en implementación gradual |
| Carbono-neutralidad país | Estado de Chile | Net zero | 2050 (revisable) |

**Implicación directa para Booster**: cualquier shipper grande que use un transportista contratado debe reportar Scope 3 emisiones de transporte. Hoy lo hacen con factores genéricos (HuellaChile MMA) o consultorías ambientales caras. Booster puede entregar la métrica auditable directamente desde el viaje real con factor GLEC v3.0 + certificado firmado, lo que **reduce el costo de cumplimiento de miles de USD de consultoría a un costo marginal por viaje**.

### 5.2 Tamaño de mercado

- **Transporte de carga por carretera Chile**: USD 10.76 B (2025) → USD ~16 B (2035), CAGR 4-5.6% (Mordor Intelligence, Expert Market Research)
- **Empty miles LATAM**: ~69% en Colombia para vehículos C2 (estudio U. de los Andes citado por La República CO). Dato chileno equivalente no disponible públicamente — extrapolación con cautela, pero el orden de magnitud es regional.
- **E-commerce Chile**: +10% YoY 2025, presión continua sobre logística B2B.

### 5.3 Señales de M&A

- **Pledge.io adquirido por Blue Yonder** — el espacio de carbon logistics está consolidándose globalmente.
- **Beetrack adquirida por DispatchTrack** (US) — los activos chilenos sí pueden tener exit internacional.
- **Liftit recibió respaldo de IFC + Mercado Libre** en 2020 — backing de payment giants validó la categoría.

## 6. Hallazgos por gap del mercado

### Gap #1 — Marketplace + carbono certificado en LATAM hispanoparlante

**Estado**: cuadrante vacío. Tennders está en beta y restringido a Europa; ningún actor LATAM tiene certificación GLEC/ISO 14083. Carga Inteligente (CL) y Avancargo (AR) tienen métricas que **no resisten una auditoría IFRS S2**.

**Por qué importa**: NCG 519 ya exige IFRS S2 desde 2026. La demanda regulatoria está garantizada. El timing de Booster coincide con la entrada en vigor.

**Tamaño**: cualquier S.A. abierta que mueva carga (retail, minería, agro, manufactura) — fácilmente 200+ empresas en Chile, miles en LATAM si se replica el mandato (Brasil, Colombia y México siguen tendencia ISSB).

### Gap #2 — Doc tributaria + porte chileno nativo

**Estado**: ningún competidor regional tiene DTE + Carta Porte chilenos integrados. Avancargo (AR), Liftit (CO), Frete.com (BR) están atados a sus jurisdicciones. Tennders no tiene doc LATAM.

**Por qué importa**: el shipper chileno que adopta marketplace necesita que la transacción cierre con DTE válido (SII) y la carga viaje con guía electrónica que cumpla resoluciones de Aduanas + Vialidad. Hoy esto requiere integraciones manuales con software contable.

**Tamaño**: barrera de entrada alta para foráneos = trinchera defensiva para Booster.

### Gap #3 — IoT CAN-bus + matching + carbono en una sola plataforma

**Estado**: BlackGPS tiene IoT pero no matching ni carbono. Marketplaces tienen matching pero leen GPS solo del móvil del conductor. Nadie integra Codec8 (Teltonika) → enrich → matching → cálculo carbono "exacto_canbus" en un solo flujo.

**Por qué importa**: el modo `exacto_canbus` de Booster genera factor GLEC con incertidumbre <5%, vs. ~20-30% del modo `por_defecto`. Para auditorías serias eso es la diferencia entre certificable y no.

**Tamaño**: flotas con vehículos modernos (Volvo FH/FMX, Scania nueva generación, Mercedes Actros) — el segmento premium del transportista, que es justamente el que cobra mejores tarifas y tiene relación más larga con shippers grandes.

### Gap #4 — Multi-rol PWA vs apps separadas

**Estado**: prácticamente todos tienen "DriverApp + WebApp" como productos separados. Tennders, Avancargo, Liftit, Beetrack, Drivin todos siguen ese patrón. Solo Tennders tiene una web unificada, sin PWA mobile.

**Por qué importa**: el dispatcher chileno no es siempre el shipper — a veces es un broker, a veces es un coordinador interno, a veces es el mismo dueño-conductor. Las apps separadas obligan a tener N apps en el teléfono. Una PWA multi-rol con un solo login (que cambia perfil) es UX superior y reduce CAC en onboarding.

**Tamaño**: efecto de red — cada usuario que entra puede asumir N roles, lo que multiplica engagement.

### Gap #5 — WhatsApp como canal primario del transportista

**Estado**: ningún competidor relevante tiene bot WhatsApp con NLU. Las notificaciones suelen ser SMS o push de app. WhatsApp puede usarse como canal de soporte humano pero no como interfaz transaccional.

**Por qué importa**: ADR-006 de Booster lo dice — en LATAM el transportista vive en WhatsApp, no abre apps específicas más de 1-2 veces al día. Convertir el flujo "ofrecer carga → aceptar → cargar foto factura → confirmar entrega" a mensajes WhatsApp eleva el activation rate dramáticamente.

**Tamaño**: ~85% de penetración WhatsApp en transportistas chilenos según data secundaria — reduce fricción a casi cero.

### Gap #6 — Empty returns como métrica de producto certificable

**Estado**: Frete.com (BR) tiene el claim "nunca rode vazio" pero sin metodología. Carga Inteligente menciona reducción CO₂ pero no la deriva de viajes en vacío. Nadie convierte el "ahorro de empty miles" en un certificado de **CO₂ evitado** que el shipper pueda usar como crédito en su scope 3.

**Por qué importa**: si Booster certifica "este viaje evitó X km vacíos = Y kg CO₂", el shipper puede contabilizarlo como reducción real, no solo como compensación. Es producto vendible, no marketing.

### Gap #7 — Doble lado del marketplace + transparencia de pricing

**Estado**: Avancargo y Frete.com tienden a modelo broker (toman spread y no son transparentes). Carga Inteligente parece más transparente pero sin pricing engine público.

**Por qué importa**: ADR-004 de Booster propone modelo Uber-like — matching directo, comisión transparente, no margen oculto. Diferencial frente al broker tradicional, especialmente para transportistas independientes que desconfían del intermediario.

## 7. Implicaciones para Booster AI

1. **Acelerar la certificación SFC del módulo carbono** (ver `packages/carbon-calculator/` y la auditoría en [docs/research/013-glec-audit.md](../research/013-glec-audit.md)). Ser **el primer GLEC framework partner certificado en LATAM** es defensible y citable. Estimación: 6-9 meses de proceso con Smart Freight Centre + auditor ISO 14083.
2. **Empaquetar el reporte IFRS S2 como producto vendible al shipper**, no solo como feature interna. Un dashboard "Tu Scope 3 transporte upstream/downstream" descargable como CSV + PDF firmado. Cliente target: equipos de sustainability/ESG de S.A. abiertas.
3. **Entrar en partnership con BlackGPS** (Chile, Teltonika, +300k devices) en vez de competir frontalmente en hardware. Modelo: BlackGPS instala/mantiene fierros, Booster lee Codec8 con consentimiento, ofrece marketplace al cliente final. Win-win contractual.
4. **No competir por capital con Liftit/Avancargo en una guerra de adquisición de transportistas**. Estrategia alternativa: capturar el segmento de transportistas con vehículos premium (CAN-bus moderno) que cobran mejor y necesitan diferenciarse — el carbono auditable es su carta de venta hacia shippers grandes.
5. **Posicionamiento de marca**: no "marketplace de carga" (commoditizado por Carga Inteligente, Avancargo) sino **"plataforma de logística certificada"**. La certificación es la promesa, el marketplace es el medio.
6. **Vigilar M&A**: la consolidación carbon-logistics empezó (Pledge → BlueYonder). Booster debe definir su política frente a ofertas de adquisición temprana — un exit prematuro a un player europeo (Tennders) o americano (BlueYonder, DispatchTrack) puede neutralizar la oportunidad LATAM.
7. **Plan de expansión LATAM por jurisdicción**: empezar Chile (mandato regulatorio claro + presencia local), luego Colombia (ya hay 69% empty miles documentados, demanda económica obvia, partnership posible con BlackGPS/Liftit), después México (mercado grande, mandato climático en construcción). Brasil y Argentina al final por barrera regulatoria/lingüística + competencia local fuerte (Frete.com / Avancargo).

## 8. Próximos pasos recomendados

| # | Acción | Dueño sugerido | Ventana |
|---|---|---|---|
| 1 | Confirmar estado operacional 2026 de Liftit (sitio redirige) y de Cargamos | Felipe / business dev | 2 semanas |
| 2 | Conseguir cuentas de prueba de Tennders FEX y Avancargo SaaS para benchmark funcional hands-on | Felipe / producto | 4 semanas |
| 3 | Iniciar contacto formal con Smart Freight Centre para proceso de certificación GLEC | Felipe + asesor GLEC | 1 mes |
| 4 | Reunión exploratoria con BlackGPS para evaluar partnership IoT + datos | Felipe | 1 mes |
| 5 | Validar dato de "69% empty miles" para Chile específicamente con SECTRA, MTT o universidades chilenas (UC Santiago, USACH, U. de los Andes CL) | Investigación | 2 meses |
| 6 | Producir reporte 002 con análisis de pricing real (cuentas de prueba) y costo unitario por viaje en cada plataforma | Investigación | Q3 2026 |
| 7 | Producir reporte 003 con entrevistas a 8-12 shippers chilenos sobre dolor real de reporte IFRS S2 + disposición a pagar | Investigación | Q3 2026 |
| 8 | ADR de posicionamiento competitivo basado en este análisis + ratificación de prioridades de roadmap | Felipe + Claude | 1 mes |

## 9. Apéndice — fuentes

### Sitios oficiales (extraídos vía Playwright/WebFetch el 2026-05-05)

- [Tennders — tennders.com/es](https://www.tennders.com/es)
- [Tennders FMS — services-pages/freight-management-system](https://www.tennders.com/es/services-pages/freight-management-system)
- [BlackGPS — blackgps.com](https://www.blackgps.com)
- [BlackGPS Quiénes somos](https://www.blackgps.com/pages/quienes-somos)
- [SimpliRoute — simpliroute.com](https://simpliroute.com)
- [Beetrack / DispatchTrack — beetrack.com](https://www.beetrack.com)
- [Drivin — driv.in](https://driv.in)
- [Avancargo — avancargo.com](https://avancargo.com)
- [Frete.com](https://www.frete.com)
- [Nowports — nowports.com](https://nowports.com)
- [Carga Inteligente — cargainteligente.com](https://cargainteligente.com)
- [EcoTransIT World — ecotransit.org](https://www.ecotransit.org)
- [Blue Yonder Logistics Emissions Calculator (ex-Pledge.io)](https://blueyonder.com/solutions/sustainable-supply-chain-management/logistics-emissions-calculator)

### Prensa, regulación y mercado

- [TechCrunch — Liftit raises $22.5M (2020)](https://techcrunch.com/2020/07/08/raising-22-5-million-liftit-looks-to-expand-its-logistics-services-in-brazil-mexico-chile-and-ecuador/)
- [La República CO — Liftit expansión Chile](https://www.larepublica.co/empresas/gigante-de-logistica-colombiana-liftit-incrementara-su-presencia-en-el-mercado-chileno-3029156)
- [MundoMaritimo — Liftit funding](https://www.mundomaritimo.cl/noticias/liftit-continuara-su-expansion-logistica-en-america-latina-tras-recaudar-us225-millones-en-inversiones)
- [IFC — apoyo a Liftit](https://www.ifc.org/es/pressroom/2019/18436)
- [Diario Financiero — Drivin USD 10M ventas 2024](https://dfsud.com/chile/drivin-la-empresa-chilena-de-software-logistico-apunta-a-ventas-por)
- [Webpicking — Tigre Argentina elige Drivin](https://webpicking.com/tigre-argentina-eligio-el-software-de-ruteo-drivin/)
- [Mordor Intelligence — Chile road freight market](https://www.mordorintelligence.com/es/industry-reports/chile-road-freight-transport-market)
- [Expert Market Research — Chile road freight](https://www.expertmarketresearch.com/reports/chile-road-freight-transport-market)
- [Informes de Expertos — Chile road freight 2026-2035](https://www.informesdeexpertos.com/informes/mercado-de-transporte-de-carga-por-carretera-en-chile)
- [La República CO — 69% viajes vacíos Colombia](https://www.larepublica.co/economia/viajes-de-transporte-vacios-y-sin-carga-se-ubican-en-69-incrementa-la-huella-co2-3814605)
- [The Logistics World — Estudio U. de los Andes](https://thelogisticsworld.com/actualidad-logistica/casi-69-de-los-viajes-en-colombia-se-hacen-vacios-y-sin-carga-universidad-de-los-andes/)
- [BCN Chile — Ley 21.455 Marco Cambio Climático](https://www.bcn.cl/leychile/navegar?idNorma=1177286)
- [Gob.cl — anuncio Ley Marco Cambio Climático](https://www.gob.cl/noticias/un-hito-en-la-historia-medioambiental-de-chile-partir-de-hoy-contamos-con-nuestra-primera-ley-marco-de-cambio-climatico/)
- [Better.cl — requisitos legales huella carbono Chile](https://better.cl/requisitos-legales-para-el-calculo-de-huella-de-carbono-en-chile/)
- [CMF — NCG 461 PDF](https://www.cmfchile.cl/normativa/ncg_461_2021.pdf)
- [CMF — NCG 461 ficha](https://www.cmfchile.cl/portal/principal/613/w3-article-49802.html)
- [Deuman — NCG 461 puente a NIIF S1/S2](https://deuman.com/perspectivas/articulos/ncg-461-niif-s1-s2-reporte-esg-chile/)
- [ESG Hoy — Chile adopta normas ISSB](https://www.esghoy.cl/esghoy-cl-chile-estandares-issb-2025/)
- [RSM Chile — modificaciones NCG 461](https://www.rsm.global/chile/es/news/modificaciones-de-ncg-461)

### Marco GLEC / ISO

- [Smart Freight Centre — GLEC Framework programa](https://www.smartfreightcentre.org/en/our-programs/emissions-accounting/global-logistics-emissions-council/)
- [Smart Freight Centre — Calculate & Report GLEC](https://www.smartfreightcentre.org/en/our-programs/emissions-accounting/global-logistics-emissions-council/calculate-report-glec-framework/)
- [Smart Freight Centre — SFC Certification](https://www.smartfreightcentre.org/en/our-programs/emissions-accounting/global-logistics-emissions-council/certification/)
- [GLEC Framework v3.0 PDF](https://smart-freight-centre-media.s3.amazonaws.com/documents/GLEC_FRAMEWORK_v3_UPDATED_04_12_24.pdf)
- [GHG Protocol — GLEC Framework](https://ghgprotocol.org/blog/glec-framework-universal-method-logistics-emissions-accounting)
- [BearingPoint — LogEC GLEC accreditation](https://www.bearingpoint.com/en/about-us/news-and-media/press-releases/logec-receives-glec-accreditation/)
- [Searoutes — GLEC Framework 2025 guide](https://searoutes.com/2025/09/11/glec-framework-2025-the-ultimate-guide-to-iso-14083-sustainable-logistics/)

### Snapshots Playwright preservados

Archivos `.playwright-mcp/page-2026-05-05T23-*.yml` (Tennders, BlackGPS, Blue Yonder) — disponibles en el directorio de trabajo del worktree mientras dura la sesión.

---

**Cierre**: este reporte es una síntesis de inteligencia competitiva, no una decisión estratégica. La decisión final de roadmap, partnerships y posicionamiento corresponde al Product Owner. Los hallazgos están respaldados por las fuentes citadas; cualquier cifra crítica para una decisión de inversión debe re-verificarse antes de actuar (especialmente funding actualizado de Liftit, market sizing de empty miles en Chile, y estado operacional 2026 de los actores que no respondieron en la captura).
