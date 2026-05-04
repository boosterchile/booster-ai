# Issues — app.boosterchile.com

Este directorio contiene un archivo Markdown por cada bug detectado en la
exploración manual del 2026-05-04.

Cada archivo tiene el mismo formato (severidad, descripción, repro, esperado vs.
actual, fix sugerido, test asociado, capturas) para que se pueda copiar y
pegar en el tracker que uses (GitHub Issues, Linear, Jira, Notion).

## Índice por severidad

### 🔴 Críticos
- [BUG-001 — Validación ausente en Crear carga](./001-cargas-validacion.md)
- [BUG-002 — Patente sin regex chilena](./002-patente-formato.md)
- [BUG-003 — AppHeader ausente en /app/certificados y /app/admin/dispositivos](./003-app-shell.md)
- [BUG-004 — RUT editable contradice la copy](./004-rut-editable.md)
- [BUG-005 — Iconos PWA dan 404](./005-pwa-icons.md)
- [BUG-006 — Mobile: tabla overflow + header roto](./006-mobile-responsive.md)

### 🟡 Menores
- [BUG-007 — Terminología técnica visible al usuario](./007-jerga-tecnica.md)
- [BUG-008 — Copy: voseo/tuteo inconsistente](./008-copy-voseo.md)
- [BUG-009 — Validación de forms inconsistente](./009-validacion-forms.md)
- [BUG-010 — Empty states inconsistentes](./010-empty-states.md)
- [BUG-011 — Cuenta: cambiar contraseña + selector empresa](./011-cuenta-funcionalidades.md)
- [BUG-012 — Validación HTML5 nativa vs componentes propios](./012-validacion-html5.md)
- [BUG-013 — Cifra de emisiones ESG ~2× referencia GLEC](./013-emisiones-glec.md)
- [BUG-014 — "Polling 30s" sin indicador cuando está stale](./014-polling-stale.md)

## Cómo migrar a tu tracker

### GitHub Issues
```bash
for f in issues/[0-9]*.md; do
  gh issue create --title "$(head -n 1 "$f" | sed 's/^# //')" --body-file "$f"
done
```

### Linear
Pegar cada archivo como issue nuevo. El primer `#` se vuelve el título.

### Jira
Usar el plugin de Markdown o copiar a la descripción en formato Atlassian.
