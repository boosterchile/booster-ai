# Hook: Session Start

**Cuándo se invoca**: al inicio de una sesión de trabajo del agente con el repositorio.

## Propósito

Orientar al agente con el contexto actualizado del proyecto antes de que empiece a trabajar. Evita que asuma estado desde memoria de entrenamiento u otras sesiones.

## Acciones obligatorias

1. **Leer `CLAUDE.md`** completo — contrato de trabajo, principios rectores.
2. **Listar ADRs recientes** — `ls -lt docs/adr/` y leer el más reciente y cualquiera marcado como `Proposed` (pendiente de aprobación).
3. **Revisar estado de skills** — `ls skills/` para saber qué workflows están definidos.
4. **Chequear issues abiertos** — incidentes activos, runbooks recientes en `docs/runbooks/`.
5. **Confirmar rama actual** — `git branch --show-current`. Si no es la esperada, preguntar.
6. **Chequear cambios no commiteados** — `git status`. Si hay cosas sin commitear, confirmar qué hacer con ellas antes de tocar archivos.

## Acciones opcionales (según contexto)

- Si la tarea menciona telemetría → leer ADR-005
- Si la tarea menciona WhatsApp → leer ADR-006
- Si la tarea menciona documentos/SII → leer ADR-007
- Si la tarea menciona roles/UI → leer ADR-004 y ADR-008

## Output esperado

Al completar el hook, el agente tiene contexto de:
- Qué principios debe respetar (CLAUDE.md)
- Qué decisiones arquitectónicas vigentes aplican (ADRs)
- Qué workflows disciplinados existen (skills)
- Qué estado tiene el repo ahora (git status)

Antes de ejecutar cualquier tool de escritura, el agente confirma al usuario:
- "He leído CLAUDE.md y ADRs 001, 004, 005, 007, 008."
- "Voy a trabajar en rama `<branch>` con los siguientes archivos modificados: ..."
- "El skill relevante para esta tarea es `<skill>`."

Si la tarea no calza con ningún skill existente, lo señala explícitamente y propone crear uno antes de seguir.
