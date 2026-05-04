# Plan de fixes — Booster Chile

Playbooks listos para que **Claude Code** (CLI) los ejecute uno a uno.
Cada archivo `XXX-*.md` es auto-contenido: contexto, archivos a localizar,
diff sugerido, comando de verificación y Definition of Done.

## Origen

Estos playbooks fueron generados a partir de una **auditoría externa de
QA** sobre `app.boosterchile.com` (2026-05-04), usando Playwright MCP
contra el ambiente productivo. Cada bug detectado tiene:

- Su **issue** en [`./issues/`](./issues/) — descripción, repro, evidencia.
- Su **playbook** en este directorio — instrucciones accionables.
- Su **test de regresión** en una suite Playwright separada (no parte de
  este repo): `tests/bugs/` cubre 7 archivos con ~20 tests que reproducen
  los bugs hasta que se arreglen. Coordinar con QA para sumar esa suite
  al CI cuando esté lista.

> **Importante**: estos playbooks fueron escritos sin acceso al repo. Las
> rutas de archivos son **inferencias razonables** (Next.js App Router +
> TypeScript + Tailwind + Firebase Auth + Zod). El primer paso de cada
> playbook es **localizar los archivos reales** con `grep` antes de
> aplicar cambios.

## Orden de ejecución sugerido

Los críticos primero. Dentro de cada bloque, el orden minimiza dependencias.

### Sprint 1 — Bloqueadores de calidad de datos (críticos)
1. [FIX-001 — Validación de Crear carga](./001-cargas-validacion.md)
2. [FIX-002 — Validación de patente chilena](./002-patente-formato.md)
3. [FIX-004 — RUT readonly en perfil](./004-rut-editable.md)

### Sprint 2 — UX bloqueadora (críticos)
4. [FIX-003 — AppHeader consistente](./003-app-shell.md)
5. [FIX-006 — Responsive móvil](./006-mobile-responsive.md)
6. [FIX-005 — Iconos PWA](./005-pwa-icons.md)

### Sprint 3 — Pulido (menores)
7. [FIX-009 — Validación forms (perfil)](./009-validacion-forms.md)
8. [FIX-012 — Migrar a validación custom](./012-validacion-html5.md)
9. [FIX-007 — Quitar jerga técnica](./007-jerga-tecnica.md)
10. [FIX-008 — Tuteo consistente](./008-copy-voseo.md)
11. [FIX-010 — EmptyState component](./010-empty-states.md)
12. [FIX-011 — Cambiar contraseña + selector empresa](./011-cuenta-funcionalidades.md)
13. [FIX-014 — Indicador de stale GPS](./014-polling-stale.md)

### Sprint 4 — Investigación (menor pero compleja)
14. [FIX-013 — Auditoría cálculo emisiones GLEC](./013-emisiones-glec.md)

## Cómo invocar Claude Code para cada fix

Estos playbooks viven dentro del repo, en `docs/playbooks/`, así que
Claude Code los puede leer directamente:

```bash
# Branch dedicada por fix
git checkout -b fix/001-cargas-validacion main

# Invocar Claude Code con la ruta dentro del repo
claude "Lee y ejecuta el playbook docs/playbooks/001-cargas-validacion.md.
Seguí cada paso, aplicá los cambios, corré las verificaciones, y pará
a confirmar antes de cualquier commit."
```

O en modo interactivo:

```bash
claude
> Implementa el fix descrito en docs/playbooks/001-cargas-validacion.md.
> Pará a confirmar antes de commitear.
```

## Estructura común de cada playbook

```markdown
1. **Resumen del problema**
2. **Evidencia** (lo que se observó externamente)
3. **Localización**: comandos `grep`/`find` para ubicar el código real
4. **Plan**: pasos ordenados
5. **Implementación**: bloques de código copy-paste, con explicación
6. **Verificación**:
   - Test automático (link al spec en tests/bugs/)
   - Verificación manual
7. **Riesgos**: qué puede romperse
8. **Rollback**: cómo revertir si algo falla
9. **DoD** (Definition of Done): checklist final
```

## Tests asociados (en este mismo repo)

Cada FIX-XXX referencia su test:

| Fix | Test |
|---|---|
| 001 | `tests/bugs/cargas-validation.spec.ts` |
| 002 | `tests/bugs/vehiculos-validation-transportista.spec.ts` |
| 003 | `tests/bugs/layout-shell.spec.ts` |
| 004 | `tests/bugs/perfil-rut.spec.ts` |
| 005 | `tests/bugs/pwa-manifest.spec.ts` |
| 006 | `tests/bugs/mobile-responsive.spec.ts` |
| 007, 008 | `tests/bugs/copy-consistency.spec.ts` |
| 009, 012 | (agregar test nuevo durante el fix) |
| 010, 011, 013, 014 | (test manual o agregar nuevos) |

Cuando un fix queda terminado, el test correspondiente debe **pasar** —
de fallar a fallar, pasa a verde. Eso confirma que la regresión está
cerrada.

## Workflow recomendado por fix

```
1. Crear branch: git checkout -b fix/001-cargas-validacion
2. Claude Code aplica los cambios siguiendo el playbook
3. Correr el test: npm test -- bugs/cargas-validation
   ↳ debe pasar de FAIL a PASS
4. Correr el smoke completo: npm run test:smoke
   ↳ no debe romper nada
5. Verificación manual rápida
6. Commit con mensaje "fix(cargas): valida ventana de pickup y direccion (BUG-001)"
7. Abrir PR linkeando el issue ../issues/001-cargas-validacion.md
```

## Convenciones de commit sugeridas

```
fix(cargas): <qué se fijó> (BUG-001)
fix(vehiculos): <qué se fijó> (BUG-002)
fix(layout): <qué se fijó> (BUG-003)
fix(perfil): <qué se fijó> (BUG-004)
chore(pwa): <qué se fijó> (BUG-005)
fix(mobile): <qué se fijó> (BUG-006)
chore(copy): <qué se fijó> (BUG-007/008)
```

## Después de cerrar todo

Cuando los 14 fixes estén en main, todos los tests de `tests/bugs/` deben
estar verdes. En ese momento:

1. Renombrar la carpeta `tests/bugs/` → `tests/regression/` (ya no son
   bugs activos, son guards anti-regresión).
2. Activar `--forbidOnly` y `retries: 2` en CI.
3. Quitar el tag `@bug` de los tests, agregar `@regression`.
