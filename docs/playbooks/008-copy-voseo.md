# FIX-008 — Tuteo consistente (eliminar voseo)

> **Severidad**: 🟡 Menor
> **Issue**: [../issues/008-copy-voseo.md](../issues/008-copy-voseo.md)
> **Test**: `tests/bugs/copy-consistency.spec.ts` (parte BUG-008)

## 1. Resumen

App apuntada a Chile (`lang="es-CL"`) pero copy mezcla voseo argentino
con tuteo, a veces en la misma frase. Decisión: **estandarizar a tuteo**.

## 2. Reemplazos

| # | Antes (voseo) | Después (tuteo) | Lugar |
|---|---|---|---|
| 1 | `Descargá los certificados firmados…` | `Descarga los certificados firmados…` | tarjeta "Certificados" en `/app` |
| 2 | `Dejar vacío si querés que pricing-engine sugiera` | (ver FIX-007) `Déjalo vacío si quieres que el sistema sugiera un precio` | placeholder Crear carga |
| 3 | `Aún no tenés certificados emitidos` | `Aún no tienes certificados emitidos` | empty state `/app/certificados` |
| 4 | `Maneja cómo iniciás sesión. Podés tener Google y contraseña vinculados…` | `Maneja cómo inicias sesión. Puedes tener Google y contraseña vinculados…` | `/app/perfil` |
| 5 | `Activá las notificaciones para enterarte cuando la otra parte te escriba` | `Activa las notificaciones para enterarte cuando la otra parte te escriba` | banner chat |
| 6 | `Escribí un mensaje…` | `Escribe un mensaje…` | placeholder chat |
| 7 | `Después podrás crear tu empresa o unirte a una existente.` | (ya está en futuro genérico, mantener) | registro |

## 3. Localización

```bash
# Búsqueda exhaustiva por verbos de voseo característicos
for verb in "querés" "tenés" "podés" "iniciás" "activá" "escribí" "descargá" "andá" "vení" "fijate"; do
  echo "=== $verb ==="
  grep -rn "$verb" apps/ src/ public/ messages/ locales/ 2>/dev/null
done
```

## 4. Implementación

Cambio mecánico de strings, archivo por archivo:

```bash
# Ejemplo manual (revisar contexto antes de cada uno)
sed -i '' 's/Descargá/Descarga/g' apps/web/app/app/page.tsx
sed -i '' 's/Aún no tenés/Aún no tienes/g' apps/web/app/app/certificados/page.tsx
# … etc.
```

> **Cuidado**: no aplicar reemplazo global ciego porque podrían existir
> strings legítimos. Por ejemplo "tenés" podría aparecer en un nombre
> propio o en una variable. Hacerlo controladamente.

## 5. Conjugaciones tú a memorizar

| Voseo (rechazar) | Tuteo (aceptar) |
|---|---|
| activá | activa |
| descargá | descarga |
| escribí | escribe |
| iniciás | inicias |
| podés | puedes |
| querés | quieres |
| tenés | tienes |
| sos | eres |
| tu cuenta (igual) | tu cuenta |
| ¿Vos sos? | ¿Tú eres? |

## 6. Verificación

### 6.1 Test automático

```bash
npm test -- bugs/copy-consistency
```

La parte de BUG-008 debe pasar para las 5 rutas. El test usa la regex:
```ts
/\b(querés|tenés|podés|iniciás|escribí|activá|descargá)\b/i
```

### 6.2 Manual

Recorrer las rutas afectadas y leer.

## 7. Lint preventivo (opcional)

Agregar regla custom de ESLint o pre-commit hook que falle si detecta
voseo en strings literales:

```js
// .eslintrc o pre-commit
const VOSEO = /\b(querés|tenés|podés|iniciás|escribí|activá|descargá|sos)\b/i;
// rule: no-restricted-syntax con regex en JSXText y string literals
```

## 8. Definition of Done

- [ ] Todos los strings de voseo identificados reemplazados por tuteo.
- [ ] `docs/copy-guide.md` actualizado con regla de tono.
- [ ] `tests/bugs/copy-consistency.spec.ts` BUG-008 → 5/5 pass.
- [ ] Commit `chore(copy): unifica tuteo (BUG-008)`.
