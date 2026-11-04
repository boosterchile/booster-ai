# ADR-079 — Modelo comercial v3: comisión al generador por tipo de carga, con tarifas y costos de servicios configurables desde admin

**Estado**: Vigente
**Fecha**: 2026-09-09
**Decider**: Felipe Vicencio (Product Owner)
**Supersede a**: [ADR-026](./026-carrier-membership-tiers-and-revenue-model.md) (comisión escalonada 12/9/7/5 % cobrada al transportista y fees mensuales en CLP; el dispositivo Teltonika en comodato se conserva bajo §4 de este ADR), [ADR-030](./030-pricing-v2-activation-commission-and-billing.md) en su modelo de comisión (tasa tomada de `membership_tiers` y descontada al carrier, metodología `pricing-v2.0`; la arquitectura pricing-engine + `liquidaciones` + `facturas_booster_clp` se conserva como base) y [ADR-031](./031-pricing-v2-activacion-escala-minima.md) (criterios de activación de pricing v2). [ADR-027](./027-pricing-model-uniform-shipper-set-with-tier-commission-roadmap.md) ya estaba superado por ADR-030; sus exclusiones de alcance (§7 de este ADR) siguen vigentes.
**No toca**: [ADR-069](./069-booster-deja-de-emitir-dte-remocion-sovos.md) / [ADR-070](./070-repositorio-documental-terceros-retencion-custodia.md) (Booster no emite DTE; recibe y archiva), [ADR-021](./021-glec-v3-compliance.md) (versionado de metodología), [ADR-039](./039-site-settings-runtime-configuration.md) (patrón de configuración runtime, que aquí se reutiliza), [ADR-076](./076-gobernanza-operador-unico.md).
**Related**: [ADR-080](./080-flujo-de-dinero-mandato-de-cobro-y-capital-de-trabajo.md) (flujo de dinero bajo mandato de cobro), Plan de Flujo de Caja sep-2026 → jun-2027 (F. Sandoval, acuerdos comerciales T-24jul … T-26ago), notas de la reunión de revisión del plan de negocio (2026-09-07), instrucción del PO del 2026-09-09, `docs/frentes-vivos.md`.

---

## Contexto

**Lo que rige hoy en código (v2).** ADR-026/030 fijan que la comisión de Booster es un porcentaje **descontado al transportista** según su membresía (`membership_tiers`: Free 12 % / Standard 9 % / Pro 7 % / Premium 5 %, con fees de $0 / $15.000 / $45.000 / $120.000 CLP al mes). `packages/pricing-engine/src/liquidacion.ts` calcula `monto_neto_carrier_clp = bruto − comisión` y Booster factura comisión + IVA al transportista. Las tasas viven en un **seed inmutable** de la migración `0019_pricing_v2` ("cambios vía nuevo tier slug + migration, NUNCA UPDATE"). `PRICING_V2_ACTIVATED` está en `true` en producción, pero no existe ningún viaje real liquidado (censo 2026-08-16: 0 viajes entregados no sintéticos).

**Lo que se acordó comercialmente entre julio y septiembre de 2026** (registrado en el Plan de Flujo de Caja sep-26 → jun-27 y en la reunión del 2026-09-07):

1. La comisión de Booster **la paga el generador de carga**, encima del precio del transportista, y se le muestra separada del flete (analogía de la entrada al concierto: precio del artista y cargo por servicio por separado).
2. La comisión se segmenta por **tipo de carga**, no por membresía: **20 % carga spot / 10 % carga programada** (clientes grandes con recurrencia); la reconciliación del plan propone retorno programado 12 %. El plan de julio (8–10 % base / 12–15 % retorno) queda descartado.
3. Los servicios recurrentes se cobran **en UF**: 1 UF por camión al mes (1–1,5 UF con gestión de flota) a la empresa de transporte; 1 UF por empresa al mes al generador; el transportista de un camión entra gratis con equipo Teltonika en comodato.
4. La huella de carbono es un producto que se vende al exportador por proyecto o contrato de temporada.
5. El financiamiento del transportista aporta a Booster una **originación de 0,3–0,5 %** del monto anticipado (ver ADR-080).

**Lo que el PO fijó el 2026-09-09** como condiciones de diseño:

- **El transportista no conoce el precio de la transacción con el generador.** Ve solo su propio precio.
- **El porcentaje de la carga spot es mayor que el de la carga programada.**
- **Los porcentajes se cambian desde la página de administración de Booster, en cualquier momento.**
- **El costo de los servicios también debe ser configurable con facilidad.**

**Por qué v2 no sirve para esto.** Con el seed inmutable, cambiar una tasa exige PR + migración + deploy (≈25 min en el mejor caso y un ciclo de CI), lo contrario de "en cualquier momento". Y el modelo de descuento al transportista es incompatible con "el transportista recibe su precio y el generador paga la comisión encima". Ya existe en el repo el patrón correcto para configuración en runtime editable por el platform-admin: `configuracion_sitio` (ADR-039), tabla versionada, singleton sobre `publicada = true`, sin redeploy.

## Decisión

### 1. Quién paga la comisión y sobre qué base

- El **precio del transportista** (`precio_transportista_clp`) es el monto que el transportista recibe por el viaje, íntegro. Es el ancla de todo cálculo.
- La **comisión de Booster** se calcula sobre ese precio y **la paga el generador, encima**: `precio_generador_clp = precio_transportista_clp + comision_clp`. Booster factura al generador `comision_clp + IVA`. El precio del transportista no lleva descuento alguno de Booster.
- La comisión es la misma para todos los transportistas: **deja de existir la comisión escalonada por membresía**. La membresía (§4) vende servicios, no descuentos de comisión.
- Cifras netas de IVA en todo el modelo; el IVA (19 %, parametrizable) se aplica solo a la factura de comisión, como en ADR-030 §6.

### 2. La tasa se determina por tipo de carga

- Nuevo campo de dominio `tipo_carga` (enum SQL en español: `spot` | `programada`) en la solicitud de carga, fijado por el generador al publicar. Valor por defecto: `spot`.
- `programada` solo está disponible para generadores a los que el platform-admin les habilitó **contrato programado** (bandera en la empresa generadora, con fecha y quién la activó). Evita que cualquier publicación elija la tasa baja.
- Tasa aplicada: `comision_spot_pct` para `spot`, `comision_programada_pct` para `programada`. Existe una tercera clave opcional, `comision_retorno_programada_pct`, que se aplica cuando el viaje es un **retorno** marcado por el matching y la carga es `programada`; mientras el matching no marque retornos (`is_backhaul_optimized` sigue sin escribirse), la clave puede quedar vacía y no altera nada. Un retorno `spot` paga la tasa spot.
- **Invariante contractual**: `comision_spot_pct > comision_programada_pct`, y si existe `comision_retorno_programada_pct`, queda entre ambas. La validación rechaza (422) cualquier configuración que lo rompa. Cambiar esta relación exige ADR nuevo.
- **Valores iniciales** (seed de la primera versión publicada, editables desde el día uno): spot 20 %, programada 10 %, retorno programada 12 %. Son los valores del acuerdo del 2026-08-26 con la reconciliación propuesta en el plan de caja §2.2; el PO puede ajustarlos desde admin sin que este ADR cambie.
- **La tasa se congela al publicar** la solicitud: la fila de la solicitud persiste `comision_pct_aplicada` y `configuracion_comercial_id`. Un cambio de configuración afecta solo publicaciones posteriores. Razón: el generador vio el total al publicar y ese total no puede moverse después.

### 3. Configuración comercial en runtime, desde admin

- Tabla nueva `configuracion_comercial`, espejo de `configuracion_sitio` (ADR-039): `id`, `version`, `config` JSONB, `publicada`, `vigente_desde`, `nota_cambio` (obligatoria), `creado_por_email`, `creado_en`. Cada cambio crea una fila nueva; nunca `UPDATE` de una publicada. Índice único parcial sobre `publicada = true`.
- Schema canónico `configuracionComercialSchema` en `packages/shared-schemas/src/configuracion-comercial.ts` (Zod, `z.infer<>`), con estas secciones:
  - `comisiones`: `spot_pct`, `programada_pct`, `retorno_programada_pct?` (0–100, dos decimales; invariante de §2).
  - `servicios`: `suscripcion_transportista_uf_camion_mes`, `suscripcion_transportista_gestion_flota_uf_camion_mes`, `suscripcion_generador_uf_empresa_mes`, `camiones_sin_cobro_por_transportista` (entero ≥ 0, inicial 1), `huella_carbono` = `{ modalidad: 'por_proyecto', precio_referencia_uf? }`.
  - `financiamiento`: `originacion_pct` (inicial 0,4; rango 0,3–0,5), `anticipo_documento_pct` (inicial 90), `plazo_pago_generador_dias` (inicial 30), `plazo_liberacion_transportista_dias` (inicial 5). Las semánticas de estas claves las fija ADR-080; aquí solo se define dónde viven.
  - `impuestos`: `iva_pct` (inicial 19).
- Endpoints en `apps/api`, protegidos con la misma allowlist de platform-admin que `site-settings.ts` (`BOOSTER_PLATFORM_ADMIN_EMAILS`, ADR-076): `GET /admin/configuracion-comercial` (publicada + historial), `PUT /admin/configuracion-comercial` (valida con Zod, aplica invariantes, exige `nota_cambio`, publica una versión nueva). Ambos con span OTel y métrica `pricing.configuracion_comercial_publicada` (counter). Cero `console.*`.
- Página `/app/platform-admin/configuracion-comercial` en `apps/web` (sección del shell platform-admin existente): formulario con los campos, previsualización del ejemplo "viaje de $700.000" recalculado en vivo, historial de versiones con nota y autor.
- Lectura en caliente: el servicio de pricing lee la versión publicada con caché en memoria de **≤ 60 s**. Un cambio en admin queda vigente para publicaciones nuevas en ese plazo, sin deploy.
- Los valores **nunca** se leen de variables de entorno, de Terraform ni de seeds de migración. La primera versión publicada la crea la migración de expansión con los valores iniciales de §2 y §4, y desde ahí manda la tabla.

### 4. Costos de servicios en UF, configurables

- Precios recurrentes se **declaran en UF** y se convierten a CLP al facturar con el valor UF del día (fuente SII), que queda capturado en la factura (`facturas_booster_clp.uf_valor_clp`, `monto_uf`). Esto reemplaza los fees fijos en CLP de ADR-026.
- Planes de suscripción (los slugs concretos y su tabla los define la spec de implementación, bajo el guard expand-only de ADR-066): transportista base por camión, transportista con gestión de flota por camión, generador por empresa. El transportista con `camiones_sin_cobro_por_transportista` o menos vehículos activos no paga suscripción; el equipo Teltonika instalado a ese transportista es **comodato**, con las reglas de devolución y kill switch de ADR-026 §4, que se conservan.
- `membership_tiers` y `carrier_memberships` **no se eliminan** (expand-only, ADR-066/069): las filas de tiers quedan como legado marcado `@deprecated` en el schema; el consent de T&Cs v2 registrado en `carrier_memberships` deja de habilitar cobro alguno. Ningún componente nuevo lee `commission_pct` de esa tabla.
- La huella de carbono se factura por proyecto; `precio_referencia_uf` es solo el valor que muestra la vitrina comercial y el admin.

### 5. Visibilidad por rol: el transportista no ve la transacción con el generador

- Toda respuesta de API, mensaje del bot de WhatsApp, notificación o pantalla dirigida a los roles **transportista** (dueño, despachador) y **conductor** expone únicamente `precio_transportista_clp`. **Nunca** expone `comision_pct`, `comision_clp`, `precio_generador_clp` ni el total facturado al generador.
- El **generador** ve el desglose completo desde la publicación: precio del transportista, comisión de Booster (porcentaje y monto), IVA de la comisión y total a pagar.
- El platform-admin ve todo.
- Se codifica como contrato: schemas de respuesta separados por audiencia en `packages/shared-schemas` (`*ParaTransportista` sin las claves prohibidas) y un test de contrato en `apps/api` que recorre las rutas de transportista/conductor y falla si un schema o un payload serializado contiene alguna clave del conjunto `{comision_pct, comision_clp, precio_generador_clp, iva_comision_clp, total_factura_generador_clp}`. Es la misma disciplina del harness `check-route-default-deny`.

### 6. Liquidación v3, versionado y activación

- `packages/pricing-engine` incorpora `calcularLiquidacionV3({ precioTransportistaClp, comisionPct, ivaRate })` → `{ precioTransportistaClp, comisionPct, comisionClp, ivaComisionClp, precioGeneradorClp, totalFacturaGeneradorClp, pricingMethodologyVersion }`, función pura, redondeo HALF_UP a CLP entero, mismos guards de entrada que v2. `PRICING_METHODOLOGY_VERSION = 'pricing-v3.0-cl-2026.09'` (bump MAJOR: cambia el pagador y la base, ADR-030 §9).
- `liquidaciones` se expande con columnas nulas nuevas (`precio_transportista_clp`, `precio_generador_clp`, `total_factura_generador_clp`, `tipo_carga`, `configuracion_comercial_id`); las columnas v2 (`monto_neto_carrier_clp`, `tier_slug_aplicado`, …) quedan `@deprecated` sin DROP. `facturas_booster_clp.empresa_destino_id` pasa a ser el generador para el tipo `comision_trip`.
- Flag `PRICING_V3_ACTIVATED` (`booleanFlag(false)` en todos los entornos; se enciende solo por env var en Cloud Run vía Terraform, patrón ADR-032/`fix-factoring-exposicion-y-flag`). Con el flag en `true`, `liquidar-trip` usa v3 y el camino v2 queda inerte; `PRICING_V2_ACTIVATED` se marca deprecado y se retira en una fase contract posterior.
- Toda liquidación persiste `pricing_methodology_version` y `configuracion_comercial_id`; se recalcula y audita con esos dos datos. Nada se re-emite retroactivamente.

### 7. Fuera de alcance (se mantiene lo vigente)

- **Formación del precio**: se mantiene la mecánica de ADR-027/030: el generador publica el precio que recibirá el transportista (hoy `precio_propuesto_clp`), el matching lo propaga sin alterarlo y el primer transportista que acepta lo congela. La frase del acuerdo del 26-ago "el transportista declara su precio" describe el caso de publicación sin precio (contraoferta del transportista); esa negociación cambia la semántica de aceptación y **se decide en ADR aparte**, no aquí.
- Surge/pricing dinámico, descuento por retorno al generador, multi-moneda y penalidades por cancelación siguen excluidos (ADR-027 §1).
- El flujo del dinero (quién cobra a quién y cuándo) lo fija ADR-080; este ADR es válido tanto en modo conector como bajo mandato de cobro.

## Consecuencias

**Positivas.** El PO cambia tasas y precios desde admin en ≤ 60 s, con historial, nota y autor, sin tocar código ni Terraform. El transportista recibe su precio íntegro y nunca ve la comisión, como pide el PO. La comisión efectiva sube respecto de v2 (15–18 % según mix spot/programada, plan de caja §1) y su base es el generador, que es quien valora la certeza de entrega. Un solo lugar calcula dinero (`pricing-engine`), con versión de metodología y de configuración capturadas por liquidación.

**Negativas / deuda declarada.** (a) `membership_tiers`, `carrier_memberships`, `liquidaciones.monto_neto_carrier_clp` y el consent de T&Cs v2 quedan como legado deprecado hasta una fase contract. (b) Los T&Cs v2 (comisión al transportista) y el adendum Cobra Hoy v1 **no describen este modelo**: hace falta T&Cs v3 con la cláusula de comisión al generador y de confidencialidad del precio antes de activar el flag; es trabajo legal, no de código. (c) Precios en UF exponen al generador a la variación mensual; se acepta porque es la práctica del mercado chileno B2B. (d) La bandera de contrato programado es una decisión manual del admin por generador; no escala sin criterio escrito (queda para la spec). (e) Con el flag apagado, el código v3 no opera: misma deuda de "código sin uso" que ADR-030 asumió, mitigada con tests puros al 100 %.

**Acciones derivadas (orden estricto; requieren slot en `docs/frentes-vivos.md`, no se ejecutan desde este ADR).**

1. Spec `.specs/modelo-comercial-v3/spec.md` con entradas, salidas y criterios de éxito (este ADR es el contrato; la spec, el plan).
2. Migración expand-only: `configuracion_comercial` + seed de la primera versión publicada; `tipo_carga` en solicitudes de carga; bandera de contrato programado en empresas; columnas nuevas en `liquidaciones` y `facturas_booster_clp`.
3. `configuracionComercialSchema` en shared-schemas + `calcularLiquidacionV3` en pricing-engine (TDD con rojo exhibido: dominio pricing).
4. Endpoints admin + página platform-admin + caché ≤ 60 s.
5. Schemas de respuesta por audiencia + test de contrato de visibilidad (§5) + adaptación del bot de WhatsApp.
6. `liquidar-trip` v3 detrás de `PRICING_V3_ACTIVATED`; cobro de suscripciones en UF con captura del valor del día.
7. T&Cs v3 publicadas y consent nuevo; recién entonces el PO enciende el flag por Terraform.

**Métricas nuevas.** `pricing.configuracion_comercial_publicada` (counter, por sección cambiada), `pricing.comision_efectiva_pct_mes` (gauge, ponderada por GMV), `pricing.publicaciones_por_tipo_carga` (counter), `pricing.visibilidad_contrato_violaciones` (counter, debe ser 0).

## Verificación

Este ADR está implementado cuando todo lo siguiente es observable:

1. Con el flag v3 encendido en un entorno de prueba, el platform-admin cambia `spot_pct` de 20 a 18 desde la página admin y una solicitud publicada 60 s después muestra al generador comisión 18 %; una solicitud publicada antes conserva 20 % (`comision_pct_aplicada`). Sin deploy en el medio.
2. `PUT /admin/configuracion-comercial` con `spot_pct ≤ programada_pct` responde 422; sin `nota_cambio`, 422; desde un email fuera de la allowlist, 403.
3. El test de contrato de visibilidad recorre todas las rutas de transportista y conductor y no encuentra ninguna clave prohibida; un schema que las incluya rompe CI.
4. `calcularLiquidacionV3` tiene tests puros con rojo exhibido para: precio 0, redondeo HALF_UP, IVA parametrizado, los tres tipos de tasa, y rechazo de entradas inválidas. Cobertura 100 % del archivo.
5. Una factura de suscripción emitida en el entorno de prueba capturó `uf_valor_clp` y `monto_uf`, y `total_clp = round(monto_uf × uf_valor_clp)`.
6. `PRICING_V3_ACTIVATED` es `false` sin env var incluso con `NODE_ENV=production` (test análogo a `config-flags.test.ts`).
7. `node scripts/repo-checks/check-adr-numbering.mjs --allow-legacy 028,034,035` en verde y las cabeceras de ADR-026/030/031 apuntan a este ADR.
