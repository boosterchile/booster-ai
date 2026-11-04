# docs/legal/

Textos legales de Booster AI: términos y condiciones, privacidad, consentimientos, contratos y adendas. Cada archivo es una versión; una versión nueva se crea en un archivo nuevo (`<documento>-vN.md`) y la anterior se conserva, porque hay aceptaciones registradas que apuntan a ella.

## Regla de publicación

**Ningún documento se publica en la app, se ofrece para aceptación ni se envía para firma sin `lawyer_review: <fecha>` en su frontmatter.**

- `lawyer_review: pendiente` significa borrador. La fecha la pone el abogado (o el PO con la constancia escrita del abogado), en el mismo PR que cambia `estado` a `vigente`.
- Un `[PENDIENTE ABOGADO: ...]` abierto impide pasar a `vigente`: se resuelve en el texto o se elimina con decisión del abogado.
- Los campos entre corchetes (`[RUT]`, `[DIRECCIÓN]`, `[PLAZO]`) se completan antes de publicar.
- El slug de versión (`slug_consentimiento`) es el valor que la Plataforma guarda como evidencia de aceptación (`consentimientos.version_aviso`, máximo 20 caracteres). Un cambio de texto relevante exige versión y slug nuevos.

Este criterio corresponde a T10-28 de `.specs/trl10/spec.md`.

## Frontmatter

Cada documento vigente o en borrador empieza con:

```yaml
---
documento: <nombre>
version: <semver>
slug_consentimiento: <slug, si se registra aceptación>
estado: borrador | vigente | reemplazado
lawyer_review: pendiente | <AAAA-MM-DD>
supersede: <archivo que reemplaza> | null
refs:
  - ADR-NNN
---
```

## Índice

| Documento | Versión | Estado | Revisión legal | Reemplaza a |
|---|---|---|---|---|
| [Términos y Condiciones v3](./terminos-de-servicio-v3.md) | 3.0.0 | Borrador | Pendiente | Términos de Servicio v2 |
| [Aviso de Privacidad v2](./aviso-privacidad-v2.md) | 2.0.0 | Borrador | Pendiente | Aviso de privacidad corto v1 |
| [Consentimientos v2](./consentimientos-v2.md) | 2.0.0 | Borrador | Pendiente | Modelo de consentimiento ESG v1 |
| [Contratos por rol v1](./contratos-por-rol-v1.md) (generador y transportista) | 1.0.0 | Borrador | Pendiente | — |
| [Adendum de mandato de cobro v1](./adendum-mandato-cobro-v1.md) | 1.0.0 | Borrador | Pendiente | Adendum Cobra Hoy v1 |

### Versiones anteriores

| Documento | Estado | Reemplazado por | Nota |
|---|---|---|---|
| [Términos de Servicio v2](./terminos-de-servicio-v2.md) | Publicado en `/legal/terminos` | Términos v3 | Describe emisión de DTE por Booster (contradice ADR-069), comisión al transportista y membresías (superadas por ADR-079). Sigue en la app hasta que la v3 tenga revisión legal y se implemente su aceptación. |
| [Aviso de privacidad corto v1](./aviso-privacidad-corto-v1.md) | Borrador | Aviso de Privacidad v2 | — |
| [Modelo de consentimiento ESG v1](./modelo-consentimiento-esg-v1.md) | Borrador | Consentimientos v2 | Su slug `esg-v1` puede figurar en consentimientos ya otorgados; no se borra. |
| [Adendum Cobra Hoy v1](./adendum-cobra-hoy-v1.md) | Publicado en `/legal/cobra-hoy` | Adendum de mandato de cobro v1 | Describe cesión con tarifa fija de Booster (superada por ADR-080). El módulo está apagado (`FACTORING_V1_ACTIVATED=false`). |

## Orden de publicación

1. Revisión legal de los cinco borradores y del sign-off de la figura del mandato de cobro (ADR-080 §6.1).
2. Código: registro de aceptación de Términos v3 para todos los roles y de los consentimientos personales (ver `consentimientos-v2.md` §6).
3. Publicación de Términos v3, Aviso de Privacidad v2 y Consentimientos v2 antes del 2026-12-01 (entrada en vigencia de la Ley 21.719).
4. Con los Términos v3 aceptados, el PO puede encender `PRICING_V3_ACTIVATED` (ADR-079, acción derivada 7).
5. El adendum de mandato de cobro se publica solo cuando se cumplan las precondiciones de ADR-080 §6.

## Lo que no va aquí

- Certificaciones y RFP de auditoría: `docs/compliance/` y `docs/audits/`.
- Material comercial de clientes: `docs/comercial/`.
