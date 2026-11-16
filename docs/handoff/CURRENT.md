# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-16 ~13:25 · America/Santiago.  
**Prod**: `e0f3ccf4` (release [43874760833](https://github.com/boosterchile/booster-ai/actions/runs/43874760833), 11:06) — api `booster-ai-api-00480-zps`, web `00426-ljx`, tráfico 100 % — #986 invitación por correo + #984 remitente `contacto@`.  
**`main`**: tip post-#990; el código en prod sigue `e0f3ccf4`.  
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `9f44887e` | #989/#988 handoff; #986 BARH-21 invitación; #985 ADR-093; #984 remitente |
| Prod (Cloud Run) | `e0f3ccf4` | Release 43874760833 success (disparo y aprobación del PO). Los 8 servicios al 100 % en su última revisión. Api `booster-ai-api-00480-zps` |

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
- La variable del remitente declarada en `infrastructure/compute.tf` no está en el servicio: queda para el próximo `terraform apply` del PO. No urge, el valor coincide con el de por defecto.

Guía oneshot: [`2026-11-16-deploy-barh21-invite-oneshot.md`](./2026-11-16-deploy-barh21-invite-oneshot.md).  
**Cursor no** dispara release ni `terraform apply` ni envía invitaciones.

## Resumen operativo (prod actual)

- Matching `activa` desde 01:15 (PO apply). **Sin observar** matching real aún → al primer matching: log `matching: elegibilidad por carga` + ofertas; registrar aquí.
- Rutas API ON; prueba dos cargas OK (datos de prueba en prod).
- #977 en prod: regla 50 % distancia medida. **Sin observar** cierre real post-deploy. Certificados con cifra baja (BOO-BKAXIK, BOO-KY7G69, BOO-4FF3XA, BOO-VZYIN2) sin reemitir.
- Remitente de los correos: `contacto@`, por el valor por defecto de la imagen (la variable no está en Cloud Run; Terraform opcional para fijarla).
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

- Specs BARH-23/24 **aceptadas** por el PO (2026-11-16 «ok», enfoque 1): `.specs/reclamar-carga-sin-oferta/`, `.specs/viaje-propio-transportista/` — sigue `plan.md` + impl. Drafts #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. Invitados completan `/crear-cuenta` + login correo+clave (`gerencia@`, `sandoval.felipe@`). (Opcional) confirmar mails From `contacto@`.
2. (Opcional) TF / env `EMAIL_FROM` en Cloud Run — sin urgencia; default de imagen ya es `contacto@`.
3. Mirar el primer matching real en `activa`; transportistas declaren carrocería.
4. Un viaje con camión CAN → primer certificado primario.
5. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello / cifras bajas.
6. Mirar Flota/Maps en prod.
7. (Opcional) Staging gemelo ADR-083. Visto ADR nuevo BARH-23/24 cuando el plan lo pida (archivo protegido).

## Lo que sigue del lado del agente

1. BARH-23/24: `plan.md` + implementación (ADR nuevo solo con permiso explícito del PO).
2. Observar / anotar el primer matching real en `activa` (logs + ofertas).
3. Con el primer cierre post-#977: confirmar v3 / no-plausible.
4. Cuando un invitado complete `/crear-cuenta` + login: anotar aquí (no asumir cuentas creadas solo por el envío).
5. `cursor-agent` **no** muta Cloud Run env, no dispara release, no envía invitaciones.

## Riesgos abiertos

Matching `activa` sin matching real observado; sin carrocería, solo `carga_seca`/`otra`. Recogida exige conductor. Certificados no reproducibles / cifras bajas sin reemitir. `cursor-agent` sin `run.services.update` / sin `actions:write` para release. Cuentas BARH-21 aún no confirmadas (invites enviados; falta `/crear-cuenta`).
