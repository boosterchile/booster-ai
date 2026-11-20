# Spec: tipos-carga-chilenos

- **Author**: agente (Cursor), por pedido del PO (opción 2 del plan post-deploy: draft anexo ADR-090)
- **Date**: 2026-11-16
- **Status**: **DRAFT / no rige / pendiente visto del PO.** No aceptada. No autoriza código, migración ni cambio de flags.
- **Linked**: [ADR-090](../../docs/adr/090-matching-desde-la-carga-vehiculo-al-despachar.md) (vigente; anexo sin validar), [ADR-092](../../docs/adr/092-tipos-carga-chilenos-anexo.md) (**DRAFT**), `.specs/matching-desde-la-carga/` §7 (ejes nuevos fuera de alcance hasta esta validación)
- **Frente**: no inventa frente nuevo. Es el trabajo abierto «Etapas 0–2 — Anexo tipos de carga chilenos» ya listado en `docs/handoff/CURRENT.md`. Fuera de slot; no toca drafts #748 / #876 / #877.

## 1. Objetivo

Validar contra normas chilenas la lista de tipos de carga del anexo de ADR-090 y dejar una propuesta aprobable (naturaleza + embalaje + condiciones) para que el PO la acepte o la corrija. Hasta esa aceptación, el producto sigue con el enum `tipo_carga` de once valores.

## 2. Estado verificado (2026-11-16)

- `packages/shared-schemas/src/domain/cargo-request.ts` → `cargoTypeSchema` con 11 valores.
- `packages/matching-algorithm/src/elegibilidad/tabla.ts` → mismos 11 tipos × 10 carrocerías (tabla aprobada 2026-11-11 para el enum vigente).
- ADR-090 decisión 4: la lista del anexo **no rige** hasta validarla.
- Flags en prod (sin cambio en este corte): matching `sombra`; `RUTAS_API_ACTIVADA` falsa/ausente.

## 3. Entradas

| Entrada | Origen |
|---|---|
| Anexo propuesto de ADR-090 | `docs/adr/090-…` §Anexo |
| Enum actual `tipo_carga` | shared-schemas + matching-algorithm |
| RSA (DTO 977/96 MINSAL) | transporte con frío; congelados −18 °C |
| DS 298/1995 MTT | transporte de sustancias peligrosas |
| NCh382:2021 | clasificación mercancías peligrosas clases 1–9 |
| DS SAG 30/2012 (+ DS 240/1993) | protección del ganado en transporte |
| Res. MTT 1/1995 + DS MOP 158/1980 + autorización Vialidad | dimensiones, pesos, permiso especial |

## 4. Salidas de este corte (docs-only)

1. ADR-092 en estado **DRAFT** con research, tabla propuesta, equivalencias y preguntas al PO.
2. Esta spec en **Draft**, con criterios de aceptación del producto **cuando** el PO apruebe la lista.
3. Ningún cambio de código, SQL, feature flag ni CURRENT operativo de flags.

## 5. Reglas de producto (propuestas; no rigen)

### 5.1 Requisitos de la carga

Cada servicio declara:

- `naturaleza` (eje 1, obligatorio) — catálogo ADR-092 §2;
- `embalaje` (eje 2, obligatorio) — catálogo ADR-092 §3;
- `manipulacion_fragil` (bool, default false);
- si `naturaleza = peligrosa` → `clase_onu` ∈ {1…9} obligatorio;
- si `naturaleza = sobredimensionada` → `requiere_autorizacion_vialidad = true`.

Peso y volumen siguen como hoy (volumen no descarta candidatas; matching-desde-la-carga §11-5).

### 5.2 Elegibilidad

Tras aprobación y PR de implementación: la tabla pura pasa de `tipo_carga`×`carroceria` a `naturaleza`×`carroceria` (y reglas de embalaje donde correspondan: p. ej. contenedor → `portacontenedor`, granel líquido → `cisterna`, ganado → `jaula`). Ese PR es dominio crítico: TDD con rojo exhibido; visto PO de la nueva matriz antes de merge.

### 5.3 Migración

Según ADR-090 §9: `expand` con columnas nuevas + relleno por equivalencias ADR-092 §5; retiro del enum viejo en `contract` posterior. El relleno toca datos → visto PO en ese PR. **Fuera de este corte.**

### 5.4 Flags

Este trabajo **no** enciende `RUTAS_API_ACTIVADA` ni pasa matching a `activa`.

## 6. Criterios de éxito

### 6.1 De este draft (ya exigibles en el PR de docs)

1. ADR-092 declara explícitamente DRAFT / no rige / pendiente visto PO.
2. Cada fila del eje 1 cita fuente verificada o se marca «operativa».
3. Se documentan las correcciones al anexo de ADR-090 (umbrales RSA; fuentes MTT+MOP+Vialidad para sobredimensión).
4. Tabla de equivalencias desde el enum actual incluida.
5. Sin cambios en `apps/`, `packages/` de runtime, flags ni migraciones.

### 6.2 Tras visto PO (fuera de este PR; criterio de término del anexo)

1. ADR-092 pasa a **Vigente** (o ADR sucesor con la lista final).
2. Spec pasa a **Aceptada**.
3. Plan de implementación con TDD: schemas Zod, migración expand, nueva tabla de compatibilidad, UI/API — en PRs posteriores, sin tocar flags salvo pedido explícito.

## 7. Fuera de alcance

- Implementar naturaleza/embalaje en código o BD.
- Migraciones `contract` o retiro del enum `tipo_carga`.
- Cambiar flags de rutas o matching.
- Emitir permisos de Vialidad, autorizaciones sanitarias RSA o hojas de seguridad DS 298.
- Clases ONU 1 y 7 en v1.
- Drafts #748, #876, #877; IAM; frentes nuevos.

## 8. Riesgos

- Aprobar la lista sin fijar umbrales de frío deja ambigüedad en el formulario (`refrigerada` vs `congelada`).
- Rellenar `perecible`→`refrigerada` a ciegas puede marcar frío donde no había; la equivalencia pide revisión caso a caso.
- Flota en prod aún con carrocerías incompletas: una matriz más estricta por naturaleza amplifica el efecto ya visto con `agricola` (matching-desde-la-carga §9). Mitigación: sigue el modo sombra hasta visto PO de flags.

## 9. Dependencias

- Visto del PO sobre las preguntas de ADR-092 §«Preguntas abiertas».
- Matching-desde-la-carga ya en prod en modo sombra; no bloquea el draft, sí bloquea el rollout del enum nuevo.

## 10. Decisiones del PO

| # | Pregunta | Estado |
|---|---|---|
| 1–6 | Ver ADR-092 §Preguntas abiertas (aprobar lista, umbrales RSA, embalajes, `clase_onu`, clases 1/7, categorías operativas) | **Pendiente** |

Sin esas respuestas esta spec permanece Draft y no autoriza implementación.
