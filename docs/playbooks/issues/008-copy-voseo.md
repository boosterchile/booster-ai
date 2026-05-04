# BUG-008 — Copy: voseo argentino mezclado con tuteo chileno

| | |
|---|---|
| **Severidad** | 🟡 Menor (consistencia regional) |
| **Componente** | varios |
| **Detectado** | 2026-05-04 |
| **Test** | `tests/bugs/copy-consistency.spec.ts` |

## Descripción

La app es para mercado chileno (`lang="es-CL"`, regiones chilenas, RUT) pero
mezcla voseo (típico argentino) con tuteo en distintas pantallas, a veces
dentro del mismo párrafo.

## Mezcla en una misma sección (`/app/perfil > Acceso a tu cuenta`)

> "**Maneja** cómo **iniciás** sesión. **Podés** tener Google y contraseña..."

- "Maneja" → tuteo (imperativo de "manejar" en 2da pers. tú).
- "iniciás" → voseo (en tuteo sería "inicias").
- "Podés" → voseo (en tuteo sería "Puedes").

## Listado completo

### Voseo detectado
| Lugar | Texto |
|---|---|
| `/app` | "Descarg**á** los certificados firmados..." |
| `/app/cargas/nueva` | "Dejar vacío si quer**és** que pricing-engine sugiera" |
| `/app/certificados` | "Aún no ten**és** certificados emitidos" |
| `/app/perfil` | "Pod**és** tener Google y contraseña" / "inici**ás** sesión" |
| Chat | "Activ**á** las notificaciones" / "Escrib**í** un mensaje..." |

### Tuteo detectado
| Lugar | Texto |
|---|---|
| `/app/perfil` | "Mantén tus datos al día" / "Actualiza tus datos personales" / "Si necesitas cambiarlo" |
| `/app/cargas` | "Crea cargas, sigue el estado..." |
| Login | "¿Ya tienes cuenta?" |

## Fix

Decidir un voice & tone (recomendado **tuteo** dado que el target es Chile)
y hacer pasada completa.

Imperativos a normalizar:
| Voseo | Tuteo |
|---|---|
| descargá | descarga |
| querés | quieres |
| tenés | tienes |
| podés | puedes |
| iniciás | inicias |
| activá | activa |
| escribí | escribe |

El test `copy-consistency.spec.ts` detecta automáticamente las apariciones
del voseo en las rutas principales.
