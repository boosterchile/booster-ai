# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-16 10:05 · America/Santiago.  
**Prod**: `74461b85` (release [43807662486](https://github.com/boosterchile/booster-ai/actions/runs/43807662486), 03:41) — #977 + matching `activa` + rutas ON.  
**`main`**: `25826165` (#986 invite correo→`/crear-cuenta`; #985 ADR-093; #984 From `contacto@`).  
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `25826165` | #986 BARH-21 invite; #985 ADR-093; #984 From+oneshot; #983/#982 handoff; #980 matching default `activa`; #977 plausibilidad |
| Prod (Cloud Run) | `74461b85` | Release 43807662486 success. Api `booster-ai-api-00479-wl2` (rutas ON; matching `activa`). **Pendiente deploy** de `25826165` |

**Flags en prod:** `RUTAS_API_ACTIVADA=true`, `MATCHING_ELEGIBILIDAD_MODO=activa`. Staging gemelo aún no existe — `docs/handoff/2026-11-16-staging-checklist-adr083.md`.

## Pendiente inmediato — deploy BARH-21 (PO)

Invitaciones reales a `gerencia@boosterchile.com` y `sandoval.felipe@gmail.com` requieren:

1. `gh workflow run release.yml --ref main` + aprobar environment **`production`**.
2. Confirmar revisión Cloud Run en `25826165`, From `contacto@` (`EMAIL_FROM` o default imagen), migración **0084** en journal/prod.
3. Invitar desde `/app/platform-admin/personal` → «Invitar por correo» → mail → `/crear-cuenta` → login correo+clave.

Oneshot exacto: [`2026-11-16-deploy-barh21-invite-oneshot.md`](./2026-11-16-deploy-barh21-invite-oneshot.md).  
**Cursor no** dispara release ni `terraform apply`.

## Resumen operativo (prod actual)

- Matching `activa` desde 01:15 (PO apply). **Sin observar** matching real aún → al primer matching: log `matching: elegibilidad por carga` + ofertas; registrar aquí.
- Rutas API ON; prueba dos cargas OK (datos de prueba en prod).
- #977 en prod: regla 50 % distancia medida. **Sin observar** cierre real post-deploy. Certificados con cifra baja (BOO-BKAXIK, BOO-KY7G69, BOO-4FF3XA, BOO-VZYIN2) sin reemitir.
- `EMAIL_FROM` en Cloud Run aún ausente pre-release → default viejo `no-reply@` hasta imagen #986 (+ TF opcional).
- `sms-fallback-gateway`: aviso Twilio faltante (deuda previa).

## Plan post-deploy 2026-11-15 — **cerrado**

| Frente | Estado |
|---|---|
| Huella consolidada | **En prod** (#956) |
| Matching desde la carga | **En prod** (#958) + cron; modo **activa** |
| Ruta consolidada | API encendida; parte 8 (contract) al final |
| Reemisión certificados | Partes 1–5 en prod. BOO-YWKZWR — PO |
| Etapas 5–6 / 0–2 | Sin empezar / drafts |

## WIP

- Este PR: handoff deploy BARH-21. Drafts #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. **Deploy BARH-21** — release + gate `production` + invitaciones (oneshot arriba).
2. Confirmar Resend acepta From `contacto@boosterchile.com`.
3. Mirar el primer matching real en `activa`; transportistas declaren carrocería.
4. Un viaje con camión CAN → primer certificado primario.
5. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello / cifras bajas.
6. Mirar Flota/Maps en prod.
7. (Opcional) Staging gemelo ADR-083.

## Lo que sigue del lado del agente (paralelo al release)

1. Observar / anotar el primer matching real en `activa` (logs + ofertas).
2. Con el primer cierre post-#977: confirmar v3 / no-plausible.
3. Post-release BARH-21: smoke invite + actualizar este CURRENT.
4. `cursor-agent` **no** muta Cloud Run env ni dispara release.
5. Candidatos: etapa 5–6, rutas parte 8 — solo con cupo y pedido.

## Riesgos abiertos

Matching `activa` sin matching real observado; sin carrocería, solo `carga_seca`/`otra`. Recogida exige conductor. Certificados no reproducibles / cifras bajas sin reemitir. `cursor-agent` sin `run.services.update` / sin `actions:write` para release. Gap main→prod bloquea invitaciones reales BARH-21.
