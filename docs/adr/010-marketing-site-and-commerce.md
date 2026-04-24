# ADR-010 — Landing comercial `boosterchile.com`: oferta de servicios, pricing, signup

**Status**: Accepted
**Date**: 2026-04-23
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-008 PWA multi-rol](./008-pwa-multirole.md), [ADR-009 Análisis competitivo](./009-competitive-analysis-and-differentiators.md)

---

## Contexto

Actualmente `boosterchile.com` es una landing estática heredada del Booster 2.0. Para comercialización inmediata (TRL 10) necesitamos un sitio que:

1. Exprese la propuesta de valor del ADR-009 con claridad y credibilidad.
2. Permita a nuevos usuarios **crear cuenta según su rol** (shipper, carrier, stakeholder) sin fricción.
3. Muestre **oferta de servicios y pricing** transparente.
4. Permita **comprar/contratar servicios** online (suscripciones o packs).
5. Sirva contenido ESG/educativo para el mercado (blog, casos, recursos).
6. Integre con el resto del sistema (auth compartido, telemetría de conversión, analytics).

El sitio debe ser **separable del producto** (apps/web PWA) porque tiene audiencias y objetivos distintos: marketing necesita SEO, velocidad de deploy, A/B testing, analytics profundos; el producto necesita auth, offline, telemetría operativa.

## Decisión

### Dos apps distintas con auth compartido

```
apps/
├── web/              # PWA del producto (ya existente, ADR-008)
│   └── dominio: app.boosterchile.com
└── marketing/        # Landing + e-commerce + blog (NUEVO, este ADR)
    └── dominio: www.boosterchile.com + boosterchile.com
```

**Por qué separadas**:
- SEO: marketing requiere SSR/SSG. El producto requiere SPA para interactividad offline.
- Bundle size: marketing debe ser <200KB inicial para performance SEO. El producto puede ser más grande.
- Deploy frequency: marketing cambia de copy/contenido frecuentemente (varias veces por día en campaign). El producto sigue ciclo de release disciplinado.
- Audiencias: marketing sirve prospectos anónimos (crawlers, visitantes). El producto sirve usuarios autenticados.
- Analytics: marketing necesita GA4 / Plausible para funnel. El producto necesita OTel + Cloud Monitoring.

**Por qué auth compartido**: Firebase Auth es el único IdP; ambos sitios lo usan. Cuando el usuario se registra en `www.boosterchile.com/signup`, se crea el User en Firebase + backend, y al hacer login en `app.boosterchile.com` ya existe.

### Stack de `apps/marketing`

| Pieza | Elección | Razón |
|-------|----------|-------|
| Framework | **Next.js 15** con App Router | SSR + SSG + ISR nativo. Lighthouse 95+ performance out-of-the-box. SEO excelente. Vercel-style DX. |
| Hosting | **Cloud Run** (imagen Docker Next.js standalone) | Mismo GCP como el resto. Serverless con scale-to-zero. Domain mapping a `www.boosterchile.com`. |
| CMS contenido | **MDX en repo** + frontmatter | Blog posts y landings como archivos Markdown versionados. Cambios de copy = PR = auditabilidad. Alternativa a un CMS externo. |
| Formularios | **react-hook-form + Zod** | Mismo patrón que apps/web. Validación compartida via `@booster-ai/shared-schemas`. |
| Pagos | **Flow.cl** (Chile) + **Stripe** (internacional futuro) | Flow es el estándar Chile (WebPay, tarjetas, transferencia). Stripe para SaaS internacional cuando escalemos. Abstracción en `packages/payment-provider`. |
| Analytics | **Plausible** (privacy-first) + **GA4** (backup) | Plausible cumple Ley 19.628 sin cookies. GA4 para ecosistema Google si se quiere doble medición. |
| A/B testing | **GrowthBook self-hosted** en Cloud Run | Open-source, feature flags + experiments. Evita dependencia de SaaS caro. |
| Styling | **Tailwind CSS 4 + shadcn/ui** | Mismo sistema que apps/web. Tokens en `@booster-ai/ui-tokens`. Consistencia de marca. |
| SEO | **next-sitemap**, structured data JSON-LD, metadata por ruta | Indexación completa + rich snippets. |

### Estructura del sitio

```
www.boosterchile.com
├── /                           # Home: value prop + CTA
├── /soluciones/
│   ├── /shippers               # "Eres dueño de carga"
│   ├── /carriers               # "Eres transportista"
│   └── /stakeholders-esg       # "Eres mandante corporativo o auditor"
├── /precios                    # Pricing page
├── /esg                        # Explicación metodología ESG
├── /observatorio-urbano        # Oferta B2G para municipios
├── /casos                      # Case studies / testimonios
├── /blog                       # Contenido SEO
├── /recursos                   # Whitepapers, calculadoras ESG, guías
├── /sobre                      # Equipo, CORFO, TRL, compliance
├── /contacto                   # Form + WhatsApp Business
├── /signup                     # Onboarding por rol → Firebase Auth
├── /ingresar                   # Redirect a app.boosterchile.com/login
├── /legal/
│   ├── /terminos
│   ├── /privacidad             # Ley 19.628 compliance
│   ├── /acuerdo-esg            # Términos para Sustainability Stakeholders
│   └── /politica-retencion     # SII 6 años
└── /api/                       # Server actions (signup, newsletter, contact form)
```

### Onboarding por rol

La pantalla `/signup` pregunta primero el rol:

```
¿Qué necesitas en Booster AI?

[🏢 Soy una empresa que quiere enviar carga]            → /signup/shipper
[🚛 Soy transportista o empresa de transporte]          → /signup/carrier
[📊 Necesito reportes de huella de carbono de terceros] → /signup/stakeholder
```

Cada flujo:

**Shipper** — 3 pasos:
1. Email + contraseña + teléfono (o registro con Google/Apple)
2. Datos empresa (RUT, razón social, industria)
3. Onboarding: "Crea tu primera carga" (wizard CargoRequest)

**Carrier** — 4 pasos:
1. Email + contraseña + teléfono (o WhatsApp OTP)
2. Datos empresa/independiente (RUT, certificado SII opcional inicial)
3. Primer vehículo (patente, tipo, capacidad, IMEI Teltonika opcional)
4. Primer conductor (para unipersonales, auto-completa con datos del owner)

**Stakeholder** — 3 pasos + consent:
1. Email + organización + rol (mandator / auditor / internal / regulator / investor)
2. Solicitar consent a un shipper o carrier (se envía invitación por email/WhatsApp)
3. Esperar aprobación → acceso read-only con scope otorgado

### Oferta de servicios y pricing

**Para Shippers** (freemium + transaccional):

| Plan | Precio | Qué incluye |
|------|--------|-------------|
| **Free** | $0 | Publicar hasta 3 cargas/mes, tracking básico, certificado ESG estándar |
| **Pro** | UF 5/mes | Cargas ilimitadas, certificados ESG premium (con factores específicos vehículo), reportes mensuales, soporte prioritario |
| **Enterprise** | Cotizar | API access, integración TMS, SLA, account manager, custom ESG standards (GRI/SASB/CDP) |

**Fee transaccional**: 5% del valor del flete (shipper paga a Booster; carrier recibe neto).

**Para Carriers** (freemium):

| Plan | Precio | Qué incluye |
|------|--------|-------------|
| **Free** | $0 | Recibir ofertas, aceptar trips, ganar dinero |
| **Pro** | UF 2/mes | Priority matching, analytics de flota, integración Teltonika, reportes ESG para clientes |

**Sin fee para carriers en el tier Free** (diferenciador vs Tennders que cobra suscripción obligatoria).

**Para Sustainability Stakeholders** (B2B enterprise):

| Plan | Precio | Qué incluye |
|------|--------|-------------|
| **Auditor** | UF 20/mes | Acceso read-only con scope consent-based, exportadores GLEC/GHG/GRI/SASB/CDP, audit trail completo |
| **Corporate Mandator** | Cotizar | Vista agregada de supply chain, reportes custom, SLA |
| **Regulator** | Gratis | Acceso conforme marco legal, previo convenio |

**Para Municipios** (B2G, ADR-012):

| Plan | Precio | Qué incluye |
|------|--------|-------------|
| **Observatorio Básico** | UF 50/mes | Dashboard de flujos de transporte en la comuna, exportación mensual |
| **Observatorio Premium** | Cotizar | Gemelo digital de la comuna, análisis predictivo, alertas de congestión |

### Checkout y pagos

- **Flow.cl** integrado para todos los planes Pro y Enterprise en Chile.
- Tarjeta + WebPay + transferencia bancaria + suscripción recurrente.
- Factura electrónica (DTE) automática vía provider del ADR-007 para cada pago.
- **Modelo de prorrateo** si suscripción se activa a mitad de mes.
- **Período de prueba gratis** 14 días para planes Pro (sin tarjeta requerida).

### Integración con el producto

- Firebase Auth unificado: una cuenta sirve para marketing y app.
- Primary redirect post-signup: `/signup/<rol>` → `app.boosterchile.com/<role-dashboard>`.
- Cookies compartidas en dominio `.boosterchile.com` para SSO.
- Analytics cross-domain: el funnel marketing → producto es trackeable.

## Consecuencias

### Positivas

- **SEO competitivo**: Next.js SSG + contenido ESG + casos reales posiciona Booster en búsquedas orgánicas que competencia ignora ("certificado huella carbono transporte", "DTE carga Chile").
- **Conversión reducida por fricción**: signup por rol con wizard ≤ 5 minutos vs competencia que requiere llamar o rellenar formularios largos.
- **Separación de ciclos de vida**: marketing puede iterar en copy varias veces al día sin tocar producto. Producto puede deployar features sin afectar SEO.
- **Revenue diversificado activo desde day 1**: 5 tiers (shipper free/pro/enterprise, carrier free/pro, stakeholder auditor/corporate/regulator, municipal basic/premium) vs competencia con 1-2 tiers.
- **Auth unificado**: UX fluida del prospect al usuario, sin re-registro.

### Negativas

- **Dos apps de mantener**: más superficie. Mitigado con tokens/componentes compartidos via `@booster-ai/ui-tokens` y `@booster-ai/ui-components`.
- **Complejidad de pricing**: 10+ SKUs requieren disciplina de pricing page clara. Mitigado con calculadoras interactivas y comparativas.
- **Dependencia de Flow.cl**: si Flow cae, pagos chilenos no funcionan. Mitigar con fallback a transferencia manual + retry automático + monitoreo.
- **Complejidad del flujo Stakeholder signup**: el consent requiere coordinación con shipper/carrier, lo que ralentiza onboarding stakeholder. Mitigar con flow asíncrono (email, WhatsApp notifications) + template de invitación.

## Implementación

### Nueva app

`apps/marketing` — Next.js 15 App Router + MDX + Tailwind + shadcn. Cloud Run deploy, domain mapping `www.boosterchile.com`.

### Nuevos packages

- `packages/payment-provider` — abstracción Flow/Stripe
- `packages/mdx-content` — loaders de MDX tipados (blog posts, pricing data)

### Infra (Terraform)

- Cloud Run service `marketing` con min-instances=1 (SEO requiere baja latencia always-on)
- Cloud CDN + Cloud Armor para DDoS protection
- Cloud Storage bucket para assets (imágenes, PDFs de whitepapers)
- Domain mapping `www.boosterchile.com` + `boosterchile.com` con certs managed

### Apps nuevas totales (post-ADR-010)

El monorepo pasa de 8 a **9 apps**: el conjunto queda en `api`, `web`, `marketing`, `matching-engine`, `telemetry-tcp-gateway`, `telemetry-processor`, `notification-service`, `whatsapp-bot`, `document-service`.

## Validación

- [ ] Lighthouse Performance ≥ 95 en mobile
- [ ] Lighthouse SEO = 100
- [ ] Lighthouse Accessibility ≥ 95
- [ ] Signup shipper/carrier/stakeholder completa en ≤ 5 clicks + ≤ 3 minutos
- [ ] Checkout Flow.cl funciona end-to-end en staging
- [ ] DTE emitida automáticamente al cerrar un pago Pro
- [ ] SSO entre marketing y app funcional
- [ ] Sitemap + structured data indexados en Google Search Console

## Referencias

- [ADR-009 Análisis competitivo](./009-competitive-analysis-and-differentiators.md)
- [ADR-008 PWA multi-rol](./008-pwa-multirole.md)
- Flow.cl docs: https://www.flow.cl/docs/api.html
- Next.js App Router: https://nextjs.org/docs/app
