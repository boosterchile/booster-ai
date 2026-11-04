# Spec — Métrica data-quality de la huella del segmento (T10-01)

- Programa: TRL 10, Fase A, criterio **T10-01 Huella medida** (`.specs/trl10/spec.md`, ADR-082).
- Relacionado: `.specs/medicion-huella-segmento/` (T12/T13), ADR-077.

## Problema

T10-01 exige que cada viaje real cierre con `emisiones_kgco2e_reales` poblado
o con degradación explícita registrada: `*Actual = null`, **métrica
data-quality** y certificación degradada. Las dos primeras ya se cumplen en
código (`recalcularNivelPostEntrega`, invariante "nunca 0" cubierta por test).
La métrica no: los contadores OTel `huella_segmento_total`,
`huella_cobertura_degradada_total` y `huella_peso_ausente_total` existen en el
proceso, pero el api no exporta métricas OTel a Cloud Monitoring (verificado
2026-10-07: 0 descriptores custom, 14 métricas log-based). Una degradación hoy
solo se descubre consultando la BD.

## Entradas

- El cierre de huella de `recalcularNivelPostEntrega` en sus dos salidas:
  la salida temprana (abort sin opt-in) y la salida principal (con UPDATE de
  `trip_metrics`).

## Salidas

1. **Evento estructurado** `huella.segmento.cierre`, uno por cierre, con
   `tripId`, `resultado` (`medida` | `degradada_cobertura` | `peso_ausente` |
   `opt_in_inactivo`), `fuente` y `motivoDegradacion`:
   - `degradada_cobertura` → `abortReason` si lo hubo (`routes_error`,
     `cap_exceeded`, `sin_observacion`), si no `cobertura_bajo_umbral`.
     Mismo valor que la etiqueta `motivo` del contador OTel.
   - `peso_ausente` → `peso_ausente`.
   - `medida` y `opt_in_inactivo` → `null`.
   En la salida principal el evento es el log existente (se le agregan
   `event`, `resultado`, `motivoDegradacion`); en la temprana se agrega uno.
   No se loguea PII (solo ids y enums).
2. **Métrica log-based** `huella/segmento_cierre` (DELTA, INT64) sobre
   `jsonPayload.event="huella.segmento.cierre"` del servicio `booster-ai-api`,
   con etiquetas `resultado`, `fuente`, `motivo`.
3. **Alerta** "Huella — cierre degradado": cualquier cierre con
   `resultado` ≠ `medida` y ≠ `opt_in_inactivo` en 1 h notifica a
   `local.alert_channel_ids`. Volumen esperado bajo (decenas de viajes/mes):
   cada degradación se revisa.

## Criterios de éxito

- [ ] Test rojo exhibido y luego verde: cada uno de los cuatro resultados
      emite exactamente un `huella.segmento.cierre` con `resultado`, `fuente`
      y `motivoDegradacion` correctos.
- [ ] La invariante "nunca 0" sigue verde.
- [ ] `terraform fmt -check` limpio; el filtro de la métrica y el de la
      alerta citan el mismo literal de evento que el código.
- [ ] `monitoring.tf` no declara IAM, Billing, SA, KMS ni firewall
      (archivo permitido por CLAUDE.md).
- [ ] lint, typecheck, tests y build del api verdes.

## Fuera de alcance

- Los dos viajes reales en prod (con y sin FMC150) que cierran T10-01: son
  operación del PO tras el release y el `terraform apply` de este PR.
- Exportar métricas OTel a Cloud Monitoring (frente aparte si se decide).
