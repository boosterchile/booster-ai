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
| 4 | `liquidar-trip` v3 detrás de `PRICING_V3_ACTIVATED` (false por defecto); suscripciones en UF con valor del día | Verificación ADR-079 §5 y §6 |
| 5 | Página pública de precios (T10-29): lee la configuración publicada y muestra solo la sección `servicios` | El HTML servido refleja la versión publicada; la comisión no aparece |

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
   - `serviciosPublicosSchema`, la proyección pública de PR 5.
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

## Reglas transversales (todas las PR)

- **Los valores comerciales nunca vienen de env, Terraform ni código.** La migración siembra la versión 1 y de ahí en adelante manda la tabla (ADR-079 §3).
- **Visibilidad (ADR-079 §5).** Ninguna respuesta a transportista o conductor contiene `comision_pct`, `comision_clp`, `precio_generador_clp`, `iva_comision_clp` ni `total_factura_generador_clp`. La página pública (PR 5) tampoco muestra comisiones, por decisión del PO del 2026-10-08.
- **Coexistencia de migraciones.** `0059` coincide con las de #748 y #761. Cualquiera que mergee después renumera, porque el journal exige contigüidad.
