# Investigaciones de mercado

Carpeta para estudios de mercado, análisis competitivo, sizing, entrevistas a clientes, pricing studies y cualquier evidencia comercial/estratégica que informe decisiones de producto en Booster AI.

No confundir con [`docs/research/`](../research/), que está reservado a investigaciones **técnicas** (auditorías de bugs, validaciones de algoritmos, análisis de cumplimiento como GLEC v3.0).

**Para conectar el research con el código**: ver [`docs/integration-plan.md`](../integration-plan.md) — documento vivo que mapea cada oportunidad/feature derivada de los reportes a los packages, apps, ADRs y tests específicos del repo.

## Qué va aquí

- **Análisis competitivo**: comparativa de marketplaces de carga (Chile, LATAM, internacional).
- **Market sizing**: TAM/SAM/SOM del mercado de retornos vacíos y huella de carbono certificada.
- **Customer discovery**: entrevistas a generadores de carga (shippers) y transportistas.
- **Pricing research**: estudios de willingness-to-pay, benchmarks de comisión.
- **Regulatorio**: cambios normativos que afecten oportunidad comercial (ej. CMNUCC, SEC, CORFO).
- **Tendencias**: ESG corporativo, decarbonización del transporte, electromovilidad, hidrógeno verde.

## Qué NO va aquí

- Auditorías de bugs o validaciones técnicas → `docs/research/`.
- Decisiones arquitectónicas → `docs/adr/`.
- Procedimientos operativos → `docs/runbooks/`.
- Decisiones de producto ya tomadas → `playbooks/`.

## Convención de nombres

`NNN-slug-descriptivo.md` con numeración correlativa, igual que ADRs.

Ejemplos:
- `001-competidores-chile-2026-q2.md`
- `002-entrevistas-shippers-retail.md`
- `003-tam-sam-som-retornos-vacios.md`
- `004-pricing-comision-marketplace.md`

Para reportes recurrentes (ej. trackers de competencia), usar sufijo de fecha: `005-competitor-tracker-2026-05.md`.

## Estructura recomendada de un reporte

```markdown
# NNN — Título

**Status**: Draft | En revisión | Cerrado
**Date**: YYYY-MM-DD
**Author**: nombre
**Scope**: una línea sobre qué cubre y qué no

## TL;DR
3-5 bullets con la conclusión accionable.

## Contexto y pregunta
Por qué se hizo esta investigación, qué decisión informa.

## Metodología
Fuentes, muestra, fechas de recolección, limitaciones.

## Hallazgos
Datos, citas, gráficos. Cada afirmación con su fuente.

## Implicaciones para Booster AI
Qué cambia en producto, pricing, GTM o roadmap.

## Próximos pasos
Acciones concretas con dueño y fecha.

## Apéndice
Datos crudos, transcripciones, links.
```

## Principio

Aplica el mismo estándar **evidence over assumption** que el resto del repo: cada cifra de mercado debe tener fuente verificable y fecha de captura. Reportes sin fuentes se marcan `Status: Draft` y no se usan para decisiones.
