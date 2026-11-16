# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-16 20:30 · America/Santiago.  
**Prod**: `e0f3ccf4` (release [43874760833](https://github.com/boosterchile/booster-ai/actions/runs/43874760833), 11:06) — api `booster-ai-api-00481-4wf` (misma imagen; revisión nueva por el apply de las 20:22), web `00426-ljx`, tráfico 100 % — #986 invitación por correo + #984 remitente `contacto@`.  
**`main`**: `96bb7155` (#996); por delante de prod con #993 y #995 sin desplegar.  
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `96bb7155` | #996 IAM de `cursor-agent` (aplicado); #995 BARH-24 viaje propio y #993 BARH-23 reclamar carga, **sin desplegar**; #992 plan |
| Prod (Cloud Run) | `e0f3ccf4` | Release 43874760833 success (disparo y aprobación del PO). Los 8 servicios al 100 % en su última revisión. Api `booster-ai-api-00481-4wf` tras el apply de Terraform |

**Flags en prod:** rutas API encendida y matching en modo `activa`, conservados tras el release. Staging gemelo aún no existe — `docs/handoff/2026-11-16-staging-checklist-adr083.md`.

## Release BARH-21 — desplegado 2026-11-16 11:06

Verificado tras el deploy:

- Los 8 servicios sirven la imagen `e0f3ccf4`.
- Migración **0084** aplicada: 85 migraciones en prod; la tabla `invitaciones_correo_cuenta` existe.
- `/health` y `/ready` del api en 200; `/crear-cuenta` en la web en 200.
- Errores desde el deploy: solo el aviso de arranque de `sms-fallback-gateway` (deuda previa).

**Invitaciones BARH-21 (PO, ~2026-11-16 America/Santiago):**

- PO confirmó envío desde `/app/platform-admin/personal` → «Invitar por correo» a `gerencia@boosterchile.com` y `sandoval.felipe@gmail.com`.
- **No** se afirma creación de cuentas: faltan `/crear-cuenta` + login correo+clave por cada invitado.
- (Opcional) Smoke: confirmar llegada From `contacto@boosterchile.com` (Resend).

**Sin verificar / opcional:**

- Que Resend acepte el remitente `contacto@` en el correo real (lo dirá el smoke o el invitado).

Guía oneshot: [`2026-11-16-deploy-barh21-invite-oneshot.md`](./2026-11-16-deploy-barh21-invite-oneshot.md).  
**Cursor no** dispara release ni `terraform apply` ni envía invitaciones.

## Terraform — IAM de `cursor-agent` y remitente (PO, 2026-11-16 20:22)

El PO aplicó un plan guardado, preparado desde `origin/main` (`96bb7155`, #996): 2 recursos nuevos, 1 cambio, 0 destrucciones.

- `cursor-agent@` recibe `roles/run.developer` solo sobre el servicio `booster-ai-api`, y `roles/iam.serviceAccountUser` sobre la cuenta de ejecución de Cloud Run.
- El servicio del api declara ahora el remitente `contacto@` como variable. Revisión `booster-ai-api-00481-4wf`, misma imagen `e0f3ccf4`; matching `activa` y rutas encendidas conservados.
- Verificado: los dos permisos en las políticas, `/health` y `/ready` en 200, sin errores del api desde el apply, y un `terraform plan` completo posterior con «No changes».
- Consecuencia: `cursor-agent` puede publicar revisiones del api (imagen, variables) sin pasar por el Environment `production`. El gate humano del release sigue para los otros servicios. Riesgo declarado en `infrastructure/iam.tf`.

## Resumen operativo (prod actual)

- Matching `activa` desde 01:15 (PO apply). **Sin observar** matching real aún → al primer matching: log `matching: elegibilidad por carga` + ofertas; registrar aquí.
- Rutas API ON; prueba dos cargas OK (datos de prueba en prod).
- #977 en prod: regla 50 % distancia medida. **Sin observar** cierre real post-deploy. Certificados con cifra baja (BOO-BKAXIK, BOO-KY7G69, BOO-4FF3XA, BOO-VZYIN2) sin reemitir.
- Remitente de los correos: `contacto@`, declarado en el servicio del api desde el apply de las 20:22.
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

- Specs BARH-23/24 **aceptadas** (2026-11-16). `plan.md` en curso → impl TDD (23 claim primero, luego 24). Drafts #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. Invitados completan `/crear-cuenta` + login correo+clave (`gerencia@`, `sandoval.felipe@`). (Opcional) confirmar mails From `contacto@`.
2. Decidir el release de #993 (BARH-23) y #995 (BARH-24), en `main` sin desplegar.
3. Mirar el primer matching real en `activa`; transportistas declaren carrocería.
4. Un viaje con camión CAN → primer certificado primario.
5. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello / cifras bajas.
6. Mirar Flota/Maps en prod.
7. (Opcional) Staging gemelo ADR-083. Visto ADR nuevo BARH-23/24 cuando el plan lo pida (archivo protegido).

## Lo que sigue del lado del agente

1. BARH-23/24: merge `plan.md` → impl TDD claim → viaje propio (ADR solo con permiso PO).
2. Observar / anotar el primer matching real en `activa` (logs + ofertas).
3. Con el primer cierre post-#977: confirmar v3 / no-plausible.
4. Cuando un invitado complete `/crear-cuenta` + login: anotar aquí (no asumir cuentas creadas solo por el envío).
5. `cursor-agent` puede actualizar el servicio del api (permiso del 2026-11-16); **no** dispara release, no corre `terraform apply`, no envía invitaciones.

## Riesgos abiertos

Matching `activa` sin matching real observado; sin carrocería, solo `carga_seca`/`otra`. Recogida exige conductor. Certificados no reproducibles / cifras bajas sin reemitir. `cursor-agent` con `run.developer` sobre el api: puede cambiar su configuración sin gate humano; sigue sin `actions:write` para release. #993 y #995 en `main` sin desplegar. Cuentas BARH-21 aún no confirmadas (invites enviados; falta `/crear-cuenta`).
