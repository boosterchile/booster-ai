# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-11-16 22:30 · America/Santiago.  
**Prod**: imagen `e0f3ccf4` (release [43874760833](https://github.com/boosterchile/booster-ai/actions/runs/43874760833)) — api `booster-ai-api-00482-pch` (env `EMAIL_FROM` vía reconcile), web `00426-ljx`, 100 %.  
**`main`**: `22f7f8fb` — por delante de prod con **#993 BARH-23** y **#995 BARH-24** sin desplegar.  
**Contrato**: `CLAUDE.md`. Frentes: `docs/frentes-vivos.md`.

## Score producto (P) vs comercial (C)

- **P (funciona)** ≈ **2.8/5** — meta **5** sin mezclar abogados. Camino: oneshot abajo.
- **C (vender/compliance)** ≈ 1.5/5 — aparte (legales, RFPs, contrato). No bloquea declarar “funciona”.
- Detalle: store `internal/gtm-score-producto-vs-legal.md`.

## Estado de prod vs main

| | Commit | Notas |
|---|---|---|
| `main` | `22f7f8fb` | #997 handoff; #996 IAM (aplicado); **#995 viaje propio + #993 reclamar** sin release |
| Prod | `e0f3ccf4` | BARH-21 + remitente; **sin** 0085 / claim / viaje propio |

**Flags:** matching `activa`, rutas API ON, `EMAIL_FROM=Booster <contacto@boosterchile.com>`. Staging gemelo: no existe.

## Siguiente paso — Score P (PO)

Oneshot: [`2026-11-16-score-p5-barh2324-oneshot.md`](./2026-11-16-score-p5-barh2324-oneshot.md).

```bash
gh workflow run release.yml --ref main
# Aprobar Environment production. Cursor NO dispara el release.
```

Post-release: migración **0085**, smoke viaje propio + reclamar, tachar evidencia E1…E8 del oneshot.

## BARH-21 (ya en prod)

- Invites enviados a `gerencia@` y `sandoval.felipe@`. **Cuentas no confirmadas** (falta `/crear-cuenta` + login).
- Oneshot histórico: [`2026-11-16-deploy-barh21-invite-oneshot.md`](./2026-11-16-deploy-barh21-invite-oneshot.md).

## Resumen operativo

- Matching `activa` **sin** matching real observado.
- Rutas API ON (prueba dos cargas OK).
- Certificados secundarios; sin primario CAN; cifras bajas sin reemitir.
- `sms-fallback-gateway`: Twilio faltante (deuda).

## Pendientes del PO (orden Score P)

1. **Release** BARH-23/24 (`release.yml` + gate) — oneshot §2.
2. Invitados: `/crear-cuenta` + login.
3. 1 activación conductor por canal (sin código manual).
4. 1 viaje E2E sin intervención → cert.
5. 1 matching real o reclamo documentado; 1 viaje propio.
6. Viaje sin FMC150 con DQ explícita.
7. (Luego) ciclo cobro técnico; CAN primario; staging (opc.).

## Lo que sigue del agente

1. Tras release: verificar revisiones/0085/flags y anotar en este archivo.
2. Ayudar con queries/logs de evidencia E2–E8; **no** operar el viaje.
3. **No** `gh workflow run release.yml`, no invitaciones, no `terraform apply` global.

## Riesgos

`main` ≠ prod en claim/viaje propio. Matching sin observación. Cuentas invite abiertas. `cursor-agent` con `run.developer` solo sobre el api (riesgo declarado). Demo domain aún vivo (T10-03).
