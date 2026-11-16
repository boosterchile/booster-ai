# Spec: reclamar carga sin oferta (BARH-23)

- **Author**: agente (Cursor), por encargo del PO
- **Date**: 2026-11-16
- **Status**: Aceptada por el PO en el chat del 2026-11-16 («ok»)
- **Linked**: [ADR-090](../../docs/adr/090-matching-desde-la-carga-vehiculo-al-despachar.md), `.specs/matching-desde-la-carga/`, `.specs/ruta-parada-servicio/`, BARH-24 (`.specs/viaje-propio-transportista/`)
- **Frente**: pedido explícito del PO (no ocupa slot TRL 10 hasta que el PO lo declare en `frentes-vivos.md`)

## 1. Objetivo

El matching automático **sigue** filtrando por elegibilidad de flota
(carrocería, capacidad). Además, un transportista activo en la zona de
recogida puede **reclamar** una carga del marketplace que **no** le fue
ofrecida (p. ej. para moverla con un vehículo de tercero que registrará en
su flota al despachar).

## 2. Decisiones del PO (2026-11-16)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿BARH-23? | **Sí** |
| 2 | ¿Cómo opera? | **B**: matching filtra ofertas; el transportista puede reclamar cargas no ofrecidas |
| 3 | ¿Al despachar? | **A**: debe declarar vehículo de su flota (propio o `es_de_tercero`) que **cumpla** elegibilidad §3.3 de matching-desde-la-carga; si no, no hay recogida |
| 4 | Enfoque | **1**: superficie de claim separada; modelo de ruta existente |

## 3. Estado verificado (hoy)

- Matching en prod: `MATCHING_ELEGIBILIDAD_MODO=activa` — solo empresas con
  configuración elegible reciben oferta.
- `POST /offers/:id/accept` opera sobre una oferta existente; no hay API de
  “claim” de un viaje abierto.
- Al despachar, `PUT /rutas/:id/configuracion` rechaza configuración no
  elegible (ruta-parada-servicio / matching §3.8).

## 4. Reglas

### 4.1 Quién puede reclamar

Usuario con membresía activa en empresa **transportista** activa. La empresa
debe tener cobertura de zona de recogida compatible con el origen del viaje
(misma regla de zona que usa el matching para candidatos de zona — no se
exige elegibilidad de flota en el claim).

### 4.2 Qué se puede reclamar

Un viaje en estado que aún admite asignación marketplace (p. ej. con ofertas
abiertas o pendiente de transportista; el `plan.md` fija el enum exacto con
tests). No se reclama un viaje ya asignado a otra empresa, cancelado o
entregado.

### 4.3 Efecto del claim

1. Crea la asignación a la empresa reclamante (mismo efecto operativo que
   aceptar una oferta: ruta `planificada` sin vehículo/conductor obligatorios
   en el claim).
2. Cierra o invalida ofertas abiertas de ese viaje hacia otras empresas
   (misma semántica de “ya no disponible” que al aceptar una oferta hoy —
   detalle en `plan.md`).
3. Registra origen `reclamo` (o equivalente) en evento/auditoría para
   distinguir de `oferta_aceptada`.
4. **No** exige que la flota sea elegible en este paso.

### 4.4 Despacho (sin cambio de regla de elegibilidad)

Declarar vehículo/arrastre/conductor en la ruta sigue §3.3 / §3.8 de
matching-desde-la-carga. Unidad de tercero: ADR-090 §3.10 / decisión 2.
Sin configuración elegible → rechazo con motivo; sin vehículo/conductor → no
hay recogida.

### 4.5 Matching automático

Sin cambio: el filtro de elegibilidad por carga permanece. El claim es un
camino paralelo, no un bypass del despacho.

## 5. Contratos públicos que cambian

Decisión del PO (vista en el PR de implementación / ADR si aplica).

| Contrato | Cambio |
|---|---|
| API transportista | Nuevo endpoint de claim (nombre exacto en `plan.md`), p. ej. `POST /viajes/:id/reclamar` o `POST /marketplace/reclamar` |
| API listado | Superficie para ver cargas reclamables en zona (puede ser extensión de listado existente) |
| Eventos / auditoría | Origen `reclamo` |
| Web transportista | UI para ver y reclamar cargas no ofrecidas |

## 6. Fuera de alcance

- Quitar o relajar el filtro de matching automático.
- Despachar sin vehículo en Booster o con vehículo que no cumple elegibilidad.
- Tercero informal no registrado en flota.
- BARH-24 (viaje propio) — spec hermana.
- Pricing / liquidación especiales del claim (usa las mismas reglas que
  aceptar oferta, salvo que `plan.md` demuestre lo contrario).

## 7. Criterios de éxito

1. Test de integración: empresa sin flota elegible para el `tipo_carga` **no**
   recibe oferta del matching, pero **sí** puede reclamar el viaje (zona OK) y
   obtiene asignación + ruta sin vehículo.
2. Test: tras el claim, otra empresa no puede aceptar/reclamar el mismo viaje.
3. Test: `PUT /rutas/:id/configuracion` con vehículo no elegible → 422 con
   motivo; con vehículo `es_de_tercero` elegible → OK.
4. Test: recogida sin vehículo/conductor → rechazo (regla vigente).
5. Matching en modo `activa`: regresión — candidatas de oferta no cambian por
   esta spec.
6. Lint, typecheck, tests, build; cobertura ≥ 80 % en código nuevo. Dominio
   crítico: TDD con rojo exhibido.

## 8. Entrega

| # | Qué | Visto PO |
|---|---|---|
| 1 | Spec + plan (este documento) | sí: este texto |
| 2 | ADR si el contrato público lo exige (API nueva) | sí: archivo protegido |
| 3 | API claim + tests | sí si cambia contrato |
| 4 | UI listado/reclamar | sí: interfaz |

## 9. Riesgo principal

Cargas reclamadas sin capacidad real inmediata: la empresa acepta y demora el
despacho. Mitigación: mismos recordatorios de “falta declarar vehículo”
(matching §3.9) aplican a asignaciones por reclamo.
