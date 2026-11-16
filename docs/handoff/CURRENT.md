# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-16 11:20 · America/Santiago.  
**Prod**: `e0f3ccf4` (release [43874760833](https://github.com/boosterchile/booster-ai/actions/runs/43874760833), 11:06) — api `booster-ai-api-00480-zps`, web `00426-ljx`, tráfico 100 % — #986 invitación por correo + #984 remitente `contacto@`.  
**`main`**: `5c5a1023` (#988, handoff de Cursor) más este handoff; el código es el de `e0f3ccf4`.  
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `5c5a1023` | #988 y #987 handoff; #986 BARH-21 invitación; #985 ADR-093; #984 remitente |
| Prod (Cloud Run) | `e0f3ccf4` | Release 43874760833 success (disparo y aprobación del PO). Los 8 servicios al 100 % en su última revisión. Api `booster-ai-api-00480-zps` |

**Flags en prod:** rutas API encendida y matching en modo `activa`, conservados tras el release. Staging gemelo aún no existe — `docs/handoff/2026-11-16-staging-checklist-adr083.md`.

## Release BARH-21 — desplegado 2026-11-16 11:06

Verificado tras el deploy:

- Los 8 servicios sirven la imagen `e0f3ccf4`.
- Migración **0084** aplicada: 85 migraciones en prod; la tabla `invitaciones_correo_cuenta` existe, con 0 filas.
- `/health` y `/ready` del api en 200; `/crear-cuenta` en la web en 200.
- Errores desde el deploy: solo el aviso de arranque de `sms-fallback-gateway` (deuda previa).

**Sin verificar:**

- No se ha enviado ninguna invitación: el flujo panel → correo → `/crear-cuenta` → login con correo y clave no se ha ejercitado en prod.
- Que Resend acepte el remitente `contacto@`. El api ya lo usa por el valor por defecto de la imagen; el primer correo real lo dirá.
- La variable del remitente declarada en `infrastructure/compute.tf` no está en el servicio: queda para el próximo `terraform apply` del PO. No urge, el valor coincide con el de por defecto.

Guía de las invitaciones: [`2026-11-16-deploy-barh21-invite-oneshot.md`](./2026-11-16-deploy-barh21-invite-oneshot.md).  
**Cursor no** dispara release ni `terraform apply`.

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

- Este PR: handoff con el release de BARH-21 en prod. Drafts #876, #877, #748: no tocar sin pedido.

## Pendientes del PO (orden)

1. Enviar las invitaciones de BARH-21 desde el panel (guía arriba; ningún agente las envió) y confirmar que Resend acepta el remitente `contacto@`.
2. `terraform apply` para declarar el remitente en el servicio del api (sin urgencia).
3. BARH-23 / BARH-24: esperan spec del PO.
4. Mirar el primer matching real en `activa`; transportistas declaren carrocería.
5. Un viaje con camión CAN → primer certificado primario.
6. Reemitir BOO-YWKZWR; decidir los 3 Teltonika sin sello / cifras bajas.
7. Mirar Flota/Maps en prod.
8. (Opcional) Staging gemelo ADR-083.

## Lo que sigue del lado del agente

1. Observar / anotar el primer matching real en `activa` (logs + ofertas).
2. Con el primer cierre post-#977: confirmar v3 / no-plausible.
3. Tras la primera invitación real de BARH-21: anotar aquí el resultado del flujo.
4. `cursor-agent` **no** muta Cloud Run env, no dispara release, no envía invitaciones.
5. Candidatos: etapa 5–6, rutas parte 8 — solo con cupo y pedido.

## Riesgos abiertos

Matching `activa` sin matching real observado; sin carrocería, solo `carga_seca`/`otra`. Recogida exige conductor. Certificados no reproducibles / cifras bajas sin reemitir. `cursor-agent` sin `run.services.update` / sin `actions:write` para release. Invitación por correo de BARH-21 en prod sin ejercitar.
