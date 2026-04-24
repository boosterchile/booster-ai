---
name: Incident (operations)
about: Registro formal de un incidente en producción
title: '[INC] '
labels: [incident, oncall]
assignees: []
---

## Severidad

- [ ] SEV-1 — prod inaccesible / data loss / breach / financial loss
- [ ] SEV-2 — funcionalidad crítica degradada para >20% usuarios / SLO breach
- [ ] SEV-3 — funcionalidad no-crítica degradada / workaround existe
- [ ] SEV-4 — cosmético

## Cronología inicial

- `started_at`:
- `detected_at`:
- `detected_by`:
- Síntoma observable:

## Estado actual

- [ ] DETECTAR (primeros 5 min)
- [ ] ESTABILIZAR (parar el dolor)
- [ ] ENTENDER (causa raíz)
- [ ] CERRADO

## Seguimiento

Ver `skills/incident-response/SKILL.md` para el workflow completo.

## Post-mortem

- [ ] Programado (SEV-1 / SEV-2 obligatorio)
- Fecha: ____
- Facilitador: ____
