# Guía de copy — Booster AI

App apuntada a Chile. Toda la copy de UI debe seguir esta guía para mantener
consistencia de tono y voz de marca.

## Tono general

- **Cercano pero profesional**. La app es una herramienta de logística B2B, no
  una red social — ni demasiado formal ni demasiado coloquial.
- **Frases cortas** (< 20 palabras siempre que sea posible).
- **Verbos en imperativo** cuando es CTA: "Crea", "Edita", "Acepta".
- **Sin signos de exclamación** salvo en mensajes de error genuinamente
  urgentes.

## Tratamiento — tuteo, no voseo

✅ **Usar tuteo (chileno)**. Estamos en Chile.
❌ **No usar voseo** (típico argentino).

| ❌ Voseo | ✅ Tuteo |
|---|---|
| descargá | descarga |
| querés | quieres |
| tenés | tienes |
| podés | puedes |
| iniciás | inicias |
| activá | activa |
| escribí | escribe |
| reintentá | inténtalo (preferido) / reintenta |
| recargá | recarga |
| esperá | espera |
| permití | permite |
| publicás | publicas |
| transportás | transportas |
| sos | eres |
| ¿Vos sos? | ¿Tú eres? |

Verificación automática (debería estar limpio):
```bash
grep -rn "querés\|tenés\|podés\|iniciás\|activá\|escribí\|descargá\|reintentá" \
  apps/web/src --include="*.tsx" --include="*.ts"
```

## Glosario — palabras prohibidas (jerga técnica)

La copy de UI **no debe filtrar nombres internos** de servicios, paquetes o
componentes. Si el usuario lo va a leer, debe estar en lenguaje natural.

| ❌ No usar | ✅ Usar en su lugar |
|---|---|
| matching engine, matching_engine | el sistema |
| pricing-engine | el sistema |
| match (sustantivo, "sin match") | búsqueda / asignación / emparejamiento |
| device(s) | dispositivo(s) |
| link | enlace |
| trip request | carga / pedido |
| shipper (en UI) | generador (de carga) |
| carrier (en UI) | transportista |
| empty backhaul | retorno vacío |
| storage state | sesión |

> Entre devs ("trip-request-create.ts", "matching-engine package", code
> comments), la jerga técnica es OK y a veces preferible. La regla aplica
> solo a strings visibles para el usuario final: JSX visible, placeholders,
> mensajes de error/éxito, copy de modales.

## Mayúsculas y formato

- **Títulos** (`<h1>`, `<h2>`): primera letra en mayúscula, el resto en
  minúscula. "Mi cuenta", "Vehículos", "Crear carga".
- **CTAs / botones**: primera letra en mayúscula. "Cancelar carga", "Sí,
  cancelar carga".
- **Acrónimos**: respetar mayúsculas. "RUT", "CO₂e", "GLEC v3.0", "SEC
  Chile".
- **Términos sostenibilidad**: "huella de carbono" (no "huella de Carbono"
  ni "Huella de Carbono"), "GLEC v3.0" (con espacio).

## Tipografía y caracteres especiales

- ✅ Apóstrofo curvo en nombres propios: **O'Higgins** (no `O'Higgins`).
- ✅ Números romanos en regiones: **XIII — Metropolitana**.
- ✅ Comillas tipográficas en citas: **"Cancelado"** (no `"Cancelado"`).
- ✅ "p. m." con espacio (forma RAE) en horas: **02:00 p. m.**.
- ✅ Punto de miles en formato chileno: **5.000 kg**.
- ✅ Formato de teléfono chileno consistente: **+56 9 1234 5678**.
- ❌ No usar emojis en copy de producto. Reservados para chat / elementos
  conversacionales.

## Empty states

Estructura recomendada (ver `EmptyState` component cuando exista):

```
<icono>
<título corto, ej. "Aún no tienes certificados emitidos">
<descripción de qué pasaría: cómo aparece contenido aquí>
<CTA opcional para acción relacionada>
```

Mensajes vacíos planos como "No hay X" sin contexto **están prohibidos**.

## Mensajes de error

- Empezar por **qué pasó** (no por qué hacer).
- Decir **qué hacer** después.
- Si es retry-able, terminar con CTA: "Inténtalo en un momento."

✅ "El certificado todavía está generándose. Espera unos segundos y
   reinténtalo."
✅ "No pudimos cargar los certificados. Inténtalo en un momento."
❌ "Error: failed to fetch."
❌ "Algo salió mal."

## Reglas de revisión

Antes de mergear un PR con copy nueva:

1. Buscar el voseo: `grep -rn "querés\|tenés\|podés\|iniciás\|activá\|...".`
2. Buscar la jerga: `grep -rn "matching\|pricing-engine\|devices\|el link"`.
3. Revisar el commit que toca strings con un compañero que no haya escrito el
   código — la copy fresca con un par de ojos siempre detecta giros raros.

## Preventivo (futuro)

Considerar agregar al pre-commit:

```js
// biome / eslint custom rule
const PROHIBITED_VOSEO = /\b(querés|tenés|podés|iniciás|activá|...)\b/i;
const PROHIBITED_JARGON = /(matching engine|pricing-engine|devices teltonika|el link)/i;
// fail si aparece en JSXText o string literal en .tsx
```

(No implementado por ahora — depende de evaluar costo/beneficio del lint
custom vs revisión manual.)
