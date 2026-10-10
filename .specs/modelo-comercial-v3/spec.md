# Spec — Modelo comercial v3 (implementación de ADR-079)

**Contrato**: [ADR-079](../../docs/adr/079-modelo-comercial-v3-comision-al-generador-configurable.md). Este documento es el plan; el ADR manda.
**Programa**: TRL 10, fase E. T10-29 ("la página pública de precios coincide con ADR-079") exige que el modelo exista en código.
**Estado**: aceptada por el PO el 2026-10-08 ("Implementar ADR-079 y luego la página"; la página pública muestra **solo** servicios en UF y huella, y la comisión se le muestra al generador dentro de la app).

## Desviación de nombre (declarada)

ADR-079 §2 nombra el campo nuevo `tipo_carga` (`spot | programada`). Ese nombre ya está tomado: el enum SQL `tipo_carga` y la columna `viajes.tipo_carga` describen la naturaleza de la carga (carga seca, refrigerada…). El campo se implementa como **`modalidad_carga`** (enum `modalidad_carga`: `spot | programada`). La semántica es exactamente la de ADR-079 §2.

## Entregas (orden de ADR-079 §Acciones derivadas)

| PR | Contenido | Criterio de salida |
|---|---|---|
| 1 | Esta spec; migración expand-only; `configuracionComercialSchema`; `calcularLiquidacionV3` y `resolverComisionPct` | Ver §PR 1 |
| 2 | `GET`/`PUT /admin/configuracion-comercial`, caché ≤ 60 s y página `/app/platform-admin/configuracion-comercial` | Verificación ADR-079 §2 (422 / 403) y prueba de caché |
| 3 | `modalidad_carga` al publicar, con la tasa congelada (`comision_pct_aplicada`, `configuracion_comercial_id`); bandera de contrato programado; schemas de respuesta por audiencia y test de contrato de visibilidad (§5); bot | Verificación ADR-079 §1 y §3 |
| 4 | `liquidar-trip` v3 detrás de `PRICING_V3_ACTIVATED` (false por defecto); vista del transportista sin comisión | Ver §PR 4 |
| 5 | Suscripciones en UF con valor del día (separadas de la PR 4: requieren fijar la fuente del valor UF) | Verificación ADR-079 Verificación 5 |
| 6 | Página pública de precios (T10-29): lee la configuración publicada y muestra solo la sección `servicios` | El HTML servido refleja la versión publicada; la comisión no aparece |

T&C v3 y el encendido del flag quedan fuera de esta spec. Son ADR-079 §Acciones paso 7, del PO y del abogado.

## PR 1 — Base

### Entradas

- Los valores iniciales de ADR-079 §2, §3 y §4:
  - comisión spot 20 %, programada 10 %, retorno programada 12 %;
  - suscripción transportista 1 UF/camión/mes, 1,5 UF con gestión de flota;
  - suscripción generador 1 UF/empresa/mes;
  - 1 camión sin cobro;
  - huella `por_proyecto`;
  - originación 0,4 %, anticipo 90 %, plazo de pago 30 días y liberación 5 días;
  - IVA 19 %.

### Salidas

1. **Migración `0059_modelo_comercial_v3.sql`** (expand-only, con su down):
   - enum `modalidad_carga`;
   - tabla `configuracion_comercial` (espejo de `configuracion_sitio`, con `vigente_desde` y `nota_cambio NOT NULL`), con índice único parcial sobre `publicada = true` y único sobre `version`;
   - seed de la versión 1 publicada;
   - `viajes`: `modalidad_carga NOT NULL DEFAULT 'spot'`, `comision_pct_aplicada numeric(5,2)` y `configuracion_comercial_id` (FK);
   - `empresas`: `contrato_programado_activado_en` y `contrato_programado_activado_por`;
   - `liquidaciones`: `precio_transportista_clp`, `precio_generador_clp`, `total_factura_generador_clp`, `modalidad_carga` y `configuracion_comercial_id`, con `tier_slug_aplicado` pasando a nullable (`DROP NOT NULL` es una relajación, no destructiva);
   - `facturas_booster_clp`: `monto_uf numeric(12,4)` y `uf_valor_clp numeric(12,2)`.
2. **`packages/shared-schemas/src/configuracion-comercial.ts`**:
   - `configuracionComercialSchema` (Zod), con las invariantes de §2 (`spot > programada`; si hay retorno, `programada ≤ retorno ≤ spot`) y los rangos de §3;
   - `CONFIGURACION_COMERCIAL_INICIAL`;
   - `serviciosPublicosSchema`, la proyección pública de PR 6.
3. **`packages/pricing-engine`**:
   - `calcularLiquidacionV3({ precioTransportistaClp, comisionPct, ivaRate })`;
   - `resolverComisionPct({ modalidad, esRetorno, comisiones })`;
   - `PRICING_METHODOLOGY_VERSION_V3 = 'pricing-v3.0-cl-2026.09'`.

   La v2 queda intacta: es la que corre con `PRICING_V3_ACTIVATED = false`.

### Criterios de éxito

- [ ] TDD con el rojo exhibido (dominio pricing). `calcularLiquidacionV3` cubre precio 0, redondeo HALF_UP, IVA parametrizado, las tres tasas vía `resolverComisionPct` y el rechazo de entradas inválidas, con **cobertura del 100 % del archivo** (ADR-079 Verificación 4).
- [ ] El schema rechaza `spot ≤ programada`, un retorno fuera de rango y porcentajes fuera de 0–100.
- [ ] Integración contra Postgres real:
  - la migración aplica y existe exactamente una versión publicada;
  - su `config` pasa `configuracionComercialSchema`;
  - un segundo `publicada = true` viola el índice;
  - `viajes.modalidad_carga` vale `spot` en filas existentes;
  - una liquidación sin `tier_slug_aplicado` se puede insertar.
- [ ] `check-migration-safety` en verde sin marcador contract; `migration-journal-integrity` en verde.
- [ ] Coverage ≥ 80 % en los paquetes tocados; lint, typecheck y build OK.

## PR 4 — Liquidación v3

### Entradas

- `PRICING_V3_ACTIVATED` (PR 3) y la tasa congelada al publicar: `viajes.comision_pct_aplicada`, `viajes.configuracion_comercial_id` y `viajes.modalidad_carga`.
- El IVA de la versión de configuración congelada (no el de la publicada al liquidar).

### Salidas

1. `liquidarTrip({ …, pricingV3Activated })`:
   - **v3 activo y viaje con tasa congelada**: `calcularLiquidacionV3`, sin exigir membresía. La fila lleva `tier_slug_aplicado = null`, `precio_transportista_clp = monto_bruto = monto_neto_carrier` (el transportista recibe íntegro), `comision_*`, `precio_generador_clp`, `total_factura_generador_clp = comisión + IVA` (lo que Booster factura al generador, ADR-079 §1; también en `total_factura_booster_clp`), `modalidad_carga`, `configuracion_comercial_id` y metodología `pricing-v3.0-cl-2026.09`.
   - **Viaje sin tasa congelada** (publicado bajo v2): camino v2 sin cambios si `PRICING_V2_ACTIVATED`; si no, `skipped_flag_disabled`. Rige el contrato vigente al publicar.
   - Idempotencia por el UNIQUE de `asignacion_id` en ambos caminos. El 23505 se detecta también envuelto por Drizzle (`cause.code`); antes solo se miraba el mensaje, que Drizzle reemplaza por "Failed query".
2. `confirmarEntregaViaje` pasa `PRICING_V3_ACTIVATED`.
3. `GET /me/liquidaciones` responde con v2 o v3 activo. Las filas v3 omiten `comision_pct`, `comision_clp`, `iva_comision_clp` y `total_factura_booster_clp`, y exponen `precio_transportista_clp`. Las filas v2 conservan su desglose.
4. La web `/app/liquidaciones` muestra "Sin comisión" en filas v3.

### Criterios de éxito

- [x] Rojo exhibido (dominio pricing) en integración contra Postgres real y en los unit de la ruta y de la web, antes de implementar.
- [x] Integración: un viaje entregado con tasa congelada produce exactamente la fila v3 esperada sin membresía; la segunda llamada devuelve `ya_liquidada`; un viaje sin tasa congelada con v2 apagado no inserta.
- [x] Ninguna fila v3 de `/me/liquidaciones` contiene claves de `CLAVES_PRIVADAS_GENERADOR` ni `total_factura_booster_clp`, y su JSON no contiene el monto de la comisión ni el de la factura.
- [x] Los tests v2 existentes pasan sin cambios de expectativa.
- [ ] Coverage ≥ 80 %, lint, typecheck, build, `lint:rls` y route default-deny en verde (ver Evidencia del PR).

## PR 5 — Suscripciones en UF

### Decisiones del PO (2026-10-08)

- **Fuente del valor UF**: API v3 de la CMF (requiere `CMF_API_KEY`), con respaldo en la tabla anual del SII. ADR-079 §4 nombra solo al SII; la CMF es la fuente oficial con API y el SII queda de respaldo.
- **IVA**: los precios en UF son **netos** y se les suma el IVA de la configuración publicada. Así, `subtotal_clp = round(monto_uf × uf_valor_clp)`, `iva_clp = round(subtotal_clp × iva)` y `total_clp = subtotal_clp + iva_clp`. Esto se aparta de la letra de ADR-079 Verificación 5 (`total_clp = round(monto_uf × uf_valor_clp)`), que dejaba la suscripción sin IVA. La regla de la Verificación 5 se cumple sobre `subtotal_clp`.
- **Quién paga**: el cobro es automático.
  - Toda empresa `activa` (sin demo ni usuarios de prueba) con rol generador paga `suscripcion_generador_uf_empresa_mes`.
  - Con rol transportista paga por camión (vehículo **motriz** y **activo**) sobre `camiones_sin_cobro_por_transportista`. Con el valor inicial 1, una empresa con 1 camión no paga y una con 3 paga 2.
  - El plan con gestión de flota lo activa el platform-admin por empresa (`empresas.gestion_flota_activada_en`), igual que el contrato programado.
  - Una empresa con ambos roles recibe una sola factura con las dos líneas.

### Salidas

1. Migración `0060_suscripciones_uf.sql` (expand-only, con su down): tabla `valores_uf` (`fecha` PK, `valor_clp`, `fuente` ∈ {cmf, sii}) y `empresas.gestion_flota_activada_en/_por`.
2. `calcularCobroSuscripcionUf` (pricing-engine, pura): líneas por concepto, `monto_uf` a 4 decimales, CLP con HALF_UP y vencimiento a 14 días.
3. `obtenerValorUf`:
   - lee `valores_uf`; si falta, consulta CMF → SII y guarda el primero que responde;
   - un valor fuera de 20.000–100.000 CLP se rechaza (falla cerrado ante un cambio de formato);
   - métricas `pricing.valor_uf_obtenido{fuente}` y `pricing.valor_uf_fallo{fuente}`.
4. `cobrarSuscripcionesUf`:
   - una factura por empresa y mes, reutilizando `tipo = 'membership_mensual'` y su UNIQUE parcial;
   - captura `monto_uf` y `uf_valor_clp`;
   - aplica el dunning y el gateway v2, que sigue **stubeado**;
   - métrica `pricing.suscripcion_facturada{concepto}`.
5. `POST /admin/jobs/cobrar-memberships-mensual`: con `PRICING_V3_ACTIVATED` cobra suscripciones UF en vez de membresías v2. Responde 503 `valor_uf_no_disponible` si ninguna fuente responde.
6. `POST /admin/jobs/valor-uf`: un tick diario que deja guardado el valor del día.
7. Admin:
   - `GET`/`PUT /admin/configuracion-comercial/gestion-flota[/:empresaId]`;
   - en la página admin, una sección "Gestión de flota" con el mismo componente que el contrato programado.
8. Terraform (`infrastructure/valor-uf.tf`, sin IAM):
   - secreto `cmf-api-key` con placeholder, montado como `CMF_API_KEY`; el placeholder cuenta como ausente;
   - job `valor-uf-diario` a las 07:15 Santiago;
   - el job de cobro mensual existente (`cobrar-memberships-mensual`) sirve a ambos modelos y su activación sigue siendo `var.cobro_mensual_activado`.

### Criterios de éxito

- [x] Rojo exhibido (dominio pricing) en `calcularCobroSuscripcionUf` y en `obtenerValorUf`/parsers, antes de implementar. `suscripcion-uf.ts` al 100 % de líneas.
- [x] Integración contra Postgres:
  - el cobro factura por rol, umbral y gestión de flota, y excluye bajo el umbral y demo;
  - `subtotal_clp = round(monto_uf × uf_valor_clp)` en cada factura;
  - repetir el tick no duplica;
  - `obtenerValorUf` cae al SII, guarda la fuente y luego sirve desde la base.
- [x] `CMF_API_KEY` ausente, vacía o con placeholder → `undefined` (test de config).
- [ ] Verificación contra las fuentes reales: el sandbox de desarrollo no tiene salida a sii.cl ni a api.cmfchile.cl. Los parsers siguen el formato documentado (`{"UFs":[{"Valor":"39.485,65","Fecha":"AAAA-MM-DD"}]}` y la tabla `table_export` del SII). La primera corrida de `valor-uf-diario` en producción es la prueba; si una fuente cambió de formato, el job loguea `fuente UF falló` y usa la otra.

## Reglas transversales (todas las PR)

- **Los valores comerciales nunca vienen de env, Terraform ni código.** La migración siembra la versión 1 y de ahí en adelante manda la tabla (ADR-079 §3).
- **Visibilidad (ADR-079 §5).** Ninguna respuesta a transportista o conductor contiene `comision_pct`, `comision_clp`, `precio_generador_clp`, `iva_comision_clp` ni `total_factura_generador_clp`. La página pública (PR 6) tampoco muestra comisiones, por decisión del PO del 2026-10-08.
- **Coexistencia de migraciones.** `0059` coincide con las de #748 y #761. Cualquiera que mergee después renumera, porque el journal exige contigüidad.
