# FIX-007 — Reemplazar jerga técnica por lenguaje de usuario

> **Severidad**: 🟡 Menor (UX / branding)
> **Issue**: [../issues/007-jerga-tecnica.md](../issues/007-jerga-tecnica.md)
> **Test**: `tests/bugs/copy-consistency.spec.ts` (parte BUG-007)

## 1. Resumen

Aparecen términos de back-end ("pricing-engine", "matching engine",
"match", "device", "link") en copy visible al usuario final.

## 2. Localización

Cada string tiene un lugar específico. Encuentralos así:

```bash
# pricing-engine
grep -rn "pricing-engine" apps/ src/ public/

# matching engine / matching / match (cuidado: "matching" puede ser legítimo en código)
grep -rn "matching engine\|matching_engine\|en proceso de match\|sin match" \
  apps/ src/ public/

# Devices Teltonika
grep -rn "Devices Teltonika\|Devices.*conectaron" apps/ src/

# "el link"
grep -rn "Te enviamos un email con el link\|el link para" apps/ src/
```

## 3. Mapeo de reemplazos

Aplicar cada uno donde aparezca el string actual:

| # | Antes | Después | Lugar (probable) |
|---|---|---|---|
| 1 | `Dejar vacío si querés que pricing-engine sugiera` | `Déjalo vacío si quieres que el sistema sugiera un precio` | placeholder en form de Crear carga |
| 2 | `El matching engine deja de buscar transportistas y la carga queda en estado "Cancelado".` | `El sistema deja de buscar transportistas y la carga queda en estado "Cancelado".` | modal cancelar carga |
| 3 | `En proceso de match, asignadas o en ruta.` | `En búsqueda de transportista, asignadas o en ruta.` | subtítulo "Cargas activas" en `/app/cargas` |
| 4 | `Cargas entregadas, canceladas o sin match.` | `Cargas entregadas, canceladas o sin asignación.` | subtítulo "Historial" en `/app/cargas` |
| 5 | `Devices Teltonika que conectaron al gateway y esperan asociación a un vehículo.` | `Dispositivos Teltonika que se conectaron y esperan asociación a un vehículo.` | subtítulo en `/app/admin/dispositivos` |
| 6 | `Te enviamos un email con el link para crear una nueva contraseña.` | `Te enviamos un email con el enlace para crear una nueva contraseña.` | `/recuperar` (Recuperar acceso) |

## 4. Implementación

Cambio puramente de strings. Para cada match del grep, reemplazar el
string. Ejemplo con `sed` (si los archivos son simples):

```bash
# CUIDADO: previsualizar antes de aplicar.
grep -rln "pricing-engine" apps/ src/ \
  | xargs sed -i '' 's/Dejar vacío si querés que pricing-engine sugiera/Déjalo vacío si quieres que el sistema sugiera un precio/g'
```

Mejor: hacerlo manualmente archivo por archivo para revisar el contexto.

## 5. Glosario para futuro

Crear un archivo `docs/copy-guide.md` para evitar regresión:

```markdown
# Guía de copy — Booster AI

## Términos prohibidos (jerga back-end)

| ❌ No usar | ✅ Usar en su lugar |
|---|---|
| matching engine / pricing-engine | el sistema |
| matching / match (sustantivo) | búsqueda / emparejamiento |
| device | dispositivo |
| link | enlace |
| trip request | carga / pedido |
| shipper | generador (de carga) |
| carrier | transportista |
| empty backhaul | retorno vacío |
| storage state | sesión |

## Tono

- Tuteo (Chile), no voseo. Ver FIX-008.
- Frases cortas (<20 palabras).
- Verbos en imperativo cuando es CTA: "Crea", "Edita", "Acepta".
```

## 6. Verificación

### 6.1 Test automático

```bash
npm test -- bugs/copy-consistency
```

La parte de "BUG-007: terminología técnica" debe pasar para las 5 rutas.

### 6.2 Manual

Abrir cada lugar listado en la tabla y confirmar el texto nuevo.

## 7. Riesgos

- Romper i18n si se introduce a futuro (claves de string cambian).
- Si los strings vienen de una traducción JSON, actualizar todas las
  copias (`es.json`, etc.).

## 8. Definition of Done

- [ ] Los 6 strings reemplazados donde aparecen.
- [ ] `docs/copy-guide.md` creado.
- [ ] `tests/bugs/copy-consistency.spec.ts` BUG-007 → 5/5 pass.
- [ ] Commit `chore(copy): reemplaza jerga tecnica por lenguaje de usuario (BUG-007)`.
