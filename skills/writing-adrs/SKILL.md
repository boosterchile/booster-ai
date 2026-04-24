# Skill: Writing ADRs (Architecture Decision Records)

**Categoría**: core-engineering
**Relacionado**: `.claude/commands/spec.md`

## Overview

Los ADRs son el registro inmutable de decisiones arquitectónicas. Cada decisión significativa (stack, patrón, contrato público, integración con tercero, política de seguridad) debe vivir en un ADR. No se edita un ADR existente — se crea uno nuevo que lo supersede.

## When to Use

Crear ADR cuando:
- Se introduce una dependencia major (framework, DB, servicio managed)
- Se cambia un patrón que aplica a múltiples módulos
- Se cambia un contrato público (API externa, schema compartido)
- Se adopta o descarta una práctica con impacto futuro
- La decisión tiene trade-offs reales que alguien querrá entender en 6 meses

**NO crear ADR** para:
- Decisiones triviales (naming convention de una variable, estilo de comentarios)
- Decisiones que ya están cubiertas por un ADR existente
- Opiniones personales sin consecuencia técnica

## Core Process

1. **Revisar ADRs existentes** en `docs/adr/` para:
   - Confirmar que la decisión no está ya tomada
   - Verificar que no contradice un ADR vigente sin supersede explícito
   - Identificar ADRs relacionados para cross-reference

2. **Numerar secuencial**: siguiente número disponible. Si un ADR antiguo fue supersedido, su número se conserva pero su status cambia a `Superseded by ADR-NNN`.

3. **Crear `docs/adr/NNN-slug.md`** con estructura mínima obligatoria:

   ```markdown
   # ADR-NNN — Título claro de la decisión

   **Status**: Proposed | Accepted | Deprecated | Superseded by ADR-MMM
   **Date**: YYYY-MM-DD
   **Decider**: <nombre+rol del que aprueba>
   **Technical contributor**: <opcional>
   **Related**: [ADR-XXX](./XXX-slug.md)

   ## Contexto
   Qué problema/situación motiva la decisión. Background factual, no opinativo.

   ## Decisión
   Qué se decide. Explícito, sin ambigüedad.

   ## Consecuencias
   ### Positivas
   ### Negativas
   ### Path de evolución futura (opcional)

   ## Validación
   Checklist para considerar la decisión implementada correctamente.

   ## Referencias
   Links externos, otros ADRs, specs.
   ```

4. **Escribir en voz activa y tiempo presente**: "Adoptamos Hono" vs "Se adoptará Hono".

5. **Ser honesto con trade-offs**: la sección Negativas debe listar debilidades reales. Sin esto, el ADR no tiene valor.

6. **Incluir tablas de decisión** cuando hay alternativas consideradas:

   | Opción | Elegida | Por qué |
   |--------|---------|---------|
   | A      | ✓       | razón 1 |
   | B      |         | razón descarte |

7. **Cross-reference** con ADRs existentes relacionados (usar links relativos).

8. **Pedir aprobación** del Product Owner antes de marcar `Accepted`. Hasta entonces, status `Proposed`.

9. **Si supersede un ADR existente**: editar el ADR viejo para cambiar su status a `Superseded by ADR-NNN` con link. No eliminar contenido del viejo.

## Techniques

### Tabla de alternativas considerada

Para decisiones de stack o integraciones, siempre comparar alternativas explícitamente. Evita "elegimos X porque nos gusta".

### Separar hechos de opiniones

"Hono es 3-5x más rápido que Express en benchmarks" (hecho verificable)
vs.
"Hono es mejor que Express" (opinión)

### Documentar lo que NO se decide

A veces ayuda ser explícito: "Este ADR NO cubre autenticación de usuarios finales (ver ADR-00X)".

## Common Rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Es obvio, no necesita ADR" | Las decisiones obvias para ti hoy no lo son para alguien nuevo en 6 meses. |
| "Edito el ADR existente en lugar de crear nuevo" | Rompe el principio de inmutabilidad. Los ADRs son historia, no documentación viva. |
| "Escribo consecuencias solo positivas" | Sin negativas, el ADR es marketing, no registro. |
| "Skippeo referencias y validación" | Sin referencias, pierde contexto. Sin validación, no se puede verificar implementación. |

## Red Flags

- ADR creado después de implementar la decisión (debe ser antes o durante)
- ADR sin consecuencias negativas listadas
- ADR que contradice otro ADR vigente sin `Supersedes`
- `Decider` vacío o "team" genérico — siempre una persona específica

## Exit Criteria

- [ ] Archivo `docs/adr/NNN-slug.md` existe con estructura completa
- [ ] Status, Date, Decider poblados con valores reales
- [ ] Contexto documenta el problema de manera factual
- [ ] Decisión es explícita y sin ambigüedad
- [ ] Consecuencias positivas Y negativas listadas
- [ ] Cross-references a ADRs relacionados presentes
- [ ] Si supersede: ADR viejo actualizado con link
- [ ] Product Owner aprobó el cambio a `Accepted`

## Referencias

- ADR framework original: https://adr.github.io/
- [ADR-001](../../docs/adr/001-stack-selection.md) como referencia de formato completo
