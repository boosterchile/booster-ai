# Code Review Checklist

Checklist de referencia para `/review` y agent `code-reviewer`. Todo PR debe pasar estos ítems antes de merge.

## Meta

- [ ] PR referencia spec (`docs/specs/<file>`) y/o issue
- [ ] PR referencia ADRs relevantes
- [ ] PR tiene sección "Evidencia" con outputs concretos
- [ ] PR tiene plan de rollback explícito
- [ ] Mensajes de commit son Conventional Commits

## Type safety

- [ ] 0 `any` sin justificación documentada
- [ ] 0 `@ts-ignore` sin descripción
- [ ] Tipos inferidos desde Zod en boundaries
- [ ] `strict: true` respetado (no se añadió `@ts-expect-error` sin razón)

## Tests

- [ ] Coverage ≥80% del código tocado
- [ ] Tests unit deterministas (sin `Date.now()`, sin network real)
- [ ] Tests integration cubren boundaries principales
- [ ] Tests E2E cubren flujo principal si hay UI
- [ ] Casos edge cubiertos (null, vacío, límites)

## Observabilidad

- [ ] Cada endpoint/operación nuevo tiene log estructurado
- [ ] Logs incluyen `trace_id` y contexto (user_id, trip_id, etc.)
- [ ] OTel spans en operaciones I/O
- [ ] Custom metrics para operaciones de negocio
- [ ] Sin `console.*` en código productivo
- [ ] PII redactada en logs

## Seguridad

- [ ] 0 secrets en código
- [ ] Validación Zod ANTES de tocar BD
- [ ] Queries parametrizadas (Drizzle lo fuerza)
- [ ] Auth requerido en endpoints que corresponde
- [ ] Authz: verificación de ownership/role en cada acceso a recurso
- [ ] Rate limiting en endpoints públicos
- [ ] Sin `eval`, `Function()`, `dangerouslySetInnerHTML` sin justificación

## Performance

- [ ] Queries usan índices (`EXPLAIN` en queries hot-path nuevas)
- [ ] Sin N+1 (loops con await anidados investigados)
- [ ] Cache considerado (Redis/Firestore) donde aplica
- [ ] Bundle size frontend bajo control

## A11y (si hay UI)

- [ ] axe-core E2E pasa sin violaciones AA
- [ ] Formularios con `<label>` asociado
- [ ] Alt text en imágenes informativas
- [ ] Contraste de color AA
- [ ] Keyboard navigation funcional
- [ ] Focus visible

## Documentación

- [ ] Código auto-explicativo (nombres claros, funciones pequeñas)
- [ ] Comentarios donde la lógica no es obvia
- [ ] README del package/app actualizado si hay cambio público
- [ ] CHANGELOG (Changesets) entry
- [ ] ADR creado si el cambio es arquitectónico

## Compliance (contexto Chile)

- [ ] Si toca documentos SII → retention lock, firma digital, hash SHA-256
- [ ] Si toca PII → consent registrado, redacción en logs
- [ ] Si toca ESG → cálculo reproducible, certificado con hash
- [ ] Si toca stakeholder ESG → scope respetado, audit log persistido
