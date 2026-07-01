# P0-C — Decisión "no reescribir historial" + checklist confirmación-demo + registro de rotación

**Frente**: F2 (PII) — `.specs/p0c-uids-demo-secret-manager/spec.md`
**Cierra**: auditoría 2026-06-14 hallazgo **P0-C** (4 Firebase UIDs reales hardcodeados como PII en `apps/api/src/services/harden-demo-accounts.ts`)
**Backlink ADR**: [`docs/adr/053-post-disclosure-account-replacement.md`](../../docs/adr/053-post-disclosure-account-replacement.md) — esta es la decisión cerrada que originó los UIDs viejos (retire+recreate post-disclosure). **ADR-053 NO se edita** (decisión PO O-A: la nota de seguimiento vive solo en `.specs/`, con este backlink). F2 no cambia la decisión de ADR-053; solo mueve la *representación* de los UIDs viejos (4 literales → env var `DEMO_OLD_UIDS` validada por Zod).
**PO**: Felipe Vicencio — dev@boosterchile.com
**Fecha**: 2026-06-18

---

## 1. Decisión: no reescribir historial git

**Decisión PO (plan padre §5/§9, ratificada 2026-06-17)**: NO se hace `git filter-repo` / force-push para borrar los 4 UIDs del historial. El fix aplica a **HEAD + commits futuros**, no al pasado.

### Por qué

- **Rompe PRs abiertos**: reescribir historia invalida los SHAs base de los PRs vivos (#425-428, #485-491). Cada uno tendría que rebasearse o recrearse.
- **Invalida clones**: todo clon/fork existente diverge irreconciliablemente del nuevo historial; cualquier `git pull` falla y exige re-clonar.
- **Costo desproporcionado para el riesgo residual**: los 4 UIDs demo **ya están deshabilitados** en Firebase (one-shot `--retire-old-batch` de ADR-053, ejecutado en prod 2026-05-25 — evidencia `.specs/sec-001-cierre/sprint-2a-evidence/t4-one-shot-retire.md`). Son identificadores de cuentas **demo retiradas**, no credenciales activas.
- **Alineado con el residual ya aceptado por ADR-053**: el literal de password `BoosterDemo2026!` (R-LIT-HIST) ya quedó aceptado en su momento como residual de historial. El mismo criterio aplica a los UIDs.

### Residual aceptado (documentado, no reabierto)

Los 4 UIDs permanecen en:
- **Git history**: commits previos (vector de origen PR #206) y diffs de los commits que tocaron `harden-demo-accounts.ts`.
- **`docs/adr/053-post-disclosure-account-replacement.md`**: contexto histórico de la decisión de retiro (no se edita — es historia cerrada).

Fuera del residual: **a partir de HEAD, los UIDs NO viven en código fuente vivo** en NINGÚN package. El grep de cierre `grep -rnE '<los 4 UIDs>' apps packages` da **0 resultados** en código fuente (verificado 2026-06-18: el único hit era el fixture de `shared-schemas`, ya reemplazado por un UID sintético). Tampoco se propagan a nuevos builds (`dist/` se regenera desde `src/`) ni a futuros commits. Esto cierra el vector de propagación continua que era el corazón de P0-C.

### Alcance del fix

- `apps/api/src/services/harden-demo-accounts.ts`: eliminada la constante `OLD_DEMO_UIDS`; añadido parser Zod `getDemoOldUids()` que lee `DEMO_OLD_UIDS` (CSV) con regex `/^[A-Za-z0-9]{20,128}$/`. `retireOldBatch` recibe los UIDs vía `opts.oldUids` (inyección) con fallback a `getDemoOldUids()`; lista vacía/ausente → no-op seguro (`{ retired: 0, skippedAlreadyDisabled: 0, failed: [] }`, sin tocar Firebase SDK ni DB, con `warn` explícito).
- `apps/api/src/config.ts`: añadida `DEMO_OLD_UIDS` al `apiEnvSchema` (opcional + validada; mismo patrón transform→array de `API_AUDIENCE`/`BOOSTER_PLATFORM_ADMIN_EMAILS`) → fail-fast al startup del API si el formato es inválido (defensa en profundidad). El service **no** importa `config.ts` (preserva el CLI standalone).
- `apps/api/scripts/harden-demo-accounts.mjs`: lee `DEMO_OLD_UIDS` vía `getDemoOldUids()`, la pasa a `retireOldBatch({ oldUids })`, actualiza el bloque de env vars del `--help`, y **avisa explícito** (no finge éxito silencioso) si la env está ausente.
- `packages/shared-schemas/src/all-schemas.test.ts`: el fixture `VALID_CUENTA.firebase_uid` usaba uno de los 4 UIDs reales (de ADR-053, pre-existente desde #335) como dato de prueba del `cuentaDemoSchema`. Reemplazado por un UID **sintético** (`demoShipperUidSintetico00000`): el round-trip solo verifica que el schema acepta una string alfanumérica, no necesita un identificador real. Detectado por los reviewers adversariales de F2 (el grep headline de cierre incluye `packages`).

---

## 2. Checklist confirmación-demo (gate para cerrar P0-C como "demo")

> Spec §7.2 / Open question O-D. Estos checkboxes son la **firma del equipo**. F2 *trata* los 4 UIDs como demo en base a la evidencia textual; el checklist confirma que esa premisa es correcta. Si falla → §4 (escalamiento).

Evidencia textual de que los 4 UIDs corresponden a cuentas demo (no usuarios reales):
- Comentarios en el código pre-extracción: `// demo-shipper viejo`, `// demo-stakeholder viejo`, `// demo-carrier viejo`, `// conductor viejo (drivers+123456785)`.
- Emails demo en ADR-053: `demo-shipper@`, `demo-carrier@`, `demo-stakeholder@boosterchile.com`, `drivers+123456785@boosterchile.invalid`.
- Los 4 ya fueron retirados (`disabled: true`) por el one-shot de ADR-053 (2026-05-25).

- [ ] **(PO/equipo)** Confirmar que los 4 UIDs son cuentas **demo** y no usuarios reales.
- [ ] **(PO/equipo)** Verificar en Firebase Admin (consola o `firebase auth:export`) que los 4 UIDs están `disabled: true`. Resultado esperado: SÍ (one-shot ADR-053 ya corrió).

---

## 3. Rotación / invalidación en Firebase (registro)

> Spec §7.3. Solo aplica si la verificación del §2 encuentra alguna de las 4 aún `disabled: false`.

Procedimiento si alguna UID estuviera aún activa:
1. Exportar `DEMO_OLD_UIDS` (CSV de los 4 UIDs viejos) en la sesión del PO.
2. **Dry-run primero**: `node apps/api/scripts/harden-demo-accounts.mjs --retire-old-batch --dry-run` (verificar el plan).
3. Retiro real: `node apps/api/scripts/harden-demo-accounts.mjs --retire-old-batch`.
4. Registrar el resultado (`retired` / `skippedAlreadyDisabled` / `failed`) abajo.

| Fecha | Operador | Acción | Resultado (`retired`/`skipped`/`failed`) | Notas |
|---|---|---|---|---|
| _(pendiente verificación PO)_ | | | | Esperado: 4 `skippedAlreadyDisabled` (ya retiradas 2026-05-25) |

---

## 4. Camino si resultaran reales (escalamiento)

> Spec §7.4 / §6 (out of scope de F2).

Si la confirmación-demo del §2 concluye que alguno de los UIDs **NO** es demo (es un usuario real):
- **Detener F2.** No mergear el cierre de P0-C como "demo".
- Abrir **incidente separado** con ventana planificada (rotación/invalidación de credenciales reales, notificación al titular si aplica Ley 19.628, evaluación de reescritura de historial con su costo asumido conscientemente).
- Este documento y el spec quedan como insumo del incidente, pero el cierre "demo" no procede.

---

## 5. Referencias

- Spec F2: `.specs/p0c-uids-demo-secret-manager/spec.md`
- ADR-053 (decisión origen, no editada): `docs/adr/053-post-disclosure-account-replacement.md`
- Evidencia one-shot retire: `.specs/sec-001-cierre/sprint-2a-evidence/t4-one-shot-retire.md`
- Auditoría 2026-06-14 (P0-C): `.specs/revision-completa-2026-06-14/`
