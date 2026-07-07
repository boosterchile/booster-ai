# Runbook de activación del onboarding — usa voseo, copy-guide exige tuteo

**Dimensión**: docs / copy · **Estado**: pendiente, requiere firma del PO (no es un cambio mecánico de código).
**Fuente**: fix round final-review W1 (2026-07-06), hallazgo R2 (extendido a docs).

## Problema

`docs/copy-guide.md` (§Tratamiento) es explícito: "Usar tuteo (chileno). Estamos en Chile. ❌ No usar voseo (típico argentino)." Esa regla está redactada pensando en copy de UI (`apps/web/src`), pero `docs/corfo/hito-2/runbook-activacion-onboarding.md` — un documento operacional que el PO (Felipe, hablante nativo chileno) ejecuta a mano — usa voseo en varios puntos:

- `docs/corfo/hito-2/runbook-activacion-onboarding.md:26` — "**Sos** el PO" (debería ser "Eres el PO").
- `docs/corfo/hito-2/runbook-activacion-onboarding.md:29` — "**Tenés** 2 horas libres" (debería ser "Tienes 2 horas libres").
- `docs/corfo/hito-2/runbook-activacion-onboarding.md:186` — comentario bash "Correrlo una vez, **observado**" — no es voseo estrictamente (participio), pero el patrón "observás" aparece en otro punto del documento (revisar con el grep de abajo antes de tocar nada, la línea puede haberse movido).

## Por qué no se corrigió en este fix round

El copy-guide, tal como está redactado, apunta a "copy de UI" (JSX visible, placeholders, mensajes de error/éxito — ver su propia sección "Glosario"), no a runbooks operacionales internos que solo lee el PO. Corregir el voseo acá es un cambio de **redacción de un documento que el propio PO escribió y usa** — no un bug de producto. Cambiar la voz de alguien sin confirmar que quiere ese cambio es el tipo de "arreglo silencioso" que la Definición de Terminado prohíbe (podría no ser un error sino el estilo personal del PO al escribir para sí mismo).

## Plan de pago

1. Preguntar al PO: ¿el copy-guide (tuteo, no voseo) debe aplicar también a runbooks operacionales internos, o solo a copy de UI de cara al usuario final?
2. Si SÍ aplica: correr `grep -rnE "\\b\\w+(á́s|és|ís)\\b" docs/corfo/ --include="*.md"` (ajustar regex — el grep simple sobre-matchea palabras con tilde que no son voseo, ej. "así", "más", "sí" — revisar cada match a mano) y corregir todo el runbook + cualquier otro doc operacional con el mismo patrón.
3. Si NO aplica (el copy-guide se mantiene scope-limited a UI): documentar esa decisión explícitamente en `docs/copy-guide.md` (una línea aclarando el alcance) para que futuros reviews no vuelvan a levantar esto como hallazgo.

## Trigger

Baja prioridad — no bloquea nada operacional (el PO entiende su propio voseo perfectamente). Resolver la próxima vez que se toque este runbook por otro motivo, o cuando el PO tenga 5 minutos para decidir el alcance del copy-guide.
