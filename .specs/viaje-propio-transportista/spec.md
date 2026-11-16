# Spec: viaje propio del transportista (BARH-24)

- **Author**: agente (Cursor), por encargo del PO
- **Date**: 2026-11-16
- **Status**: Borrador — decisiones de producto del PO en chat; pendiente revisión del texto por el PO antes de implementar
- **Linked**: [ADR-088](../../docs/adr/088-ruta-parada-servicio.md), `.specs/ruta-parada-servicio/`, `.specs/matching-desde-la-carga/`, BARH-23 (`.specs/reclamar-carga-sin-oferta/`)
- **Frente**: pedido explícito del PO (no ocupa slot TRL 10 hasta que el PO lo declare en `frentes-vivos.md`)

## 1. Objetivo

El transportista puede **crear un servicio/viaje propio** en Booster **fuera
del matching** (carga que no nace de un generador vía marketplace) y
**agruparlo en la misma ruta** con servicios aceptados o reclamados del
marketplace.

## 2. Decisiones del PO (2026-11-16)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿BARH-24? | **Sí** |
| 2 | ¿Qué es viaje propio? | **A**: alta manual fuera del matching; mezclable en la misma ruta con servicios Booster |
| 3 | ¿Cliente? | **C**: generador **registrado** en Booster **o** cliente **externo** (datos libres) |
| 4 | Enfoque | **1**: superficie de alta propia; reutiliza `POST /rutas/:id/servicios` |

## 3. Estado verificado (hoy)

- `POST /trip-requests-v2` es del **generador**; el transportista no crea viajes.
- Tras aceptar ofertas, el transportista arma rutas con asignaciones ya
  aceptadas (`POST /rutas/:id/servicios`).
- No hay API/UI de viaje externo ni de servicio fuera del marketplace.

## 4. Reglas

### 4.1 Quién crea

Usuario con rol de oficina en empresa transportista activa
(`dueno|admin|despachador` — mismo gate de escritura que declarar
configuración de ruta).

### 4.2 Alta del viaje propio

Campos mínimos (nombres canónicos en `plan.md` / shared-schemas):

- Origen y destino (dirección / geo como el resto de viajes).
- Tipo de carga, peso (volumen opcional).
- Ventana de recogida (si aplica el modelo vigente).
- Cliente:
  - **Registrado**: `generador_empresa_id` (o vínculo equivalente existente), o
  - **Externo**: nombre (obligatorio) + RUT y contacto opcionales pero
    validados con Zod si vienen.

El viaje queda marcado como origen `propio_transportista` (columna o enum —
`plan.md` elige expand-only sin romper lecturas actuales).

### 4.3 Asignación

Al crear el viaje propio se crea de inmediato la asignación a **esa**
empresa transportista (no pasa por matching ni ofertas). Nace con ruta
`planificada` (o se engancha a una ruta existente en el mismo flujo — detalle
UX en `plan.md`).

### 4.4 Mezcla en ruta

Los servicios propios usan el mismo modelo de ruta/parada/servicio (ADR-088).
`POST /rutas/:id/servicios` acepta asignaciones propias de la empresa igual
que las de marketplace. Capacidad por tramo y elegibilidad al declarar
vehículo: mismas reglas que hoy (§4.4 ruta-parada / matching §3.8).

### 4.5 Visibilidad

- El transportista ve y opera el servicio propio en sus listas/rutas.
- Si el cliente es generador registrado: ve el servicio en su superficie de
  generador **solo si** el vínculo lo permite (mismo tenant/empresa); si no
  hay producto de “compartir con generador” aún, el `plan.md` documenta el
  mínimo (al menos el transportista opera; compartir con generador puede ser
  parte 2).
- Cliente externo: **no** tiene login; no hay portal de externo en esta spec.

### 4.6 Huella y certificación

Mismas reglas que un servicio marketplace una vez hay vehículo declarado
(ADR-077 / huella consolidada). Sin vehículo: estimación por defecto como
matching §3.12. No se inventa un nivel de sello distinto para “propio”.

### 4.7 Matching

Los viajes propios **no** generan ofertas ni entran al matching como carga
a ofrecer a terceros.

## 5. Contratos públicos que cambian

| Contrato | Cambio |
|---|---|
| Esquema BD | Marca de origen propio + campos de cliente externo (expand-only) |
| API transportista | `POST` alta de viaje/servicio propio |
| API rutas | Agrupar asignación propia (si hace falta ajuste de validación) |
| Web transportista | Formulario de alta + flujo a ruta |

## 6. Fuera de alcance

- Import TMS / API batch (enfoque C descartado como único camino).
- Portal de login para cliente externo.
- Cambiar pricing marketplace para servicios propios (liquidación “propia”
  puede ser `null`/fuera de cobra-hoy hasta una spec de cobro).
- BARH-23 (claim) — spec hermana.
- Transbordo, multi-arrastre.

## 7. Criterios de éxito

1. Test de integración: transportista crea viaje propio con generador
   registrado → asignación a su empresa → aparece en listado operativo.
2. Test: crea viaje propio con cliente externo (nombre + RUT válido) → OK;
   RUT inválido → 400 Zod.
3. Test: agrupa en una ruta un servicio de oferta aceptada + uno propio;
   declarar configuración elegible → OK; no elegible → 422.
4. Test: el viaje propio **no** dispara matching / no crea ofertas.
5. Lint, typecheck, tests, build; cobertura ≥ 80 %. Dominio crítico donde
   toque factoring/matching/rutas: TDD con rojo exhibido.

## 8. Entrega

| # | Qué | Visto PO |
|---|---|---|
| 1 | Spec + plan | sí: este texto |
| 2 | ADR / migración schema si aplica | sí: protegido / datos |
| 3 | API + tests | sí si contrato público |
| 4 | UI alta + mezcla en ruta | sí: interfaz |

## 9. Riesgo principal

Cliente externo sin cuenta: el generador “de verdad” no ve el viaje en
Booster. Aceptado en esta slice; parte 2 puede invitar/vincular.
