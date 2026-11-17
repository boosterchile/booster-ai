# One-shot — Score P→5: release BARH-23/24 + evidencia de funcionamiento

**Fecha**: 2026-11-16 · America/Santiago  
**Foco**: **Score P (producto/ops)** — legales fuera de alcance de este oneshot.  
**Quién dispara release / gate**: **PO**.  
**Quién no**: Cursor — no `gh workflow run release.yml`, no aprueba `production`.

Baseline Score P hoy ≈ **2.8/5**. Meta de este oneshot: desbloquear dims Matching + Flujo (hacia ~3.5–4) con código en prod y checklist de evidencia operable.

```bash
TZ=America/Santiago date
```

## 1. Qué hay en `main` y aún no en la imagen de prod

| PR | Commit | Qué trae |
|---|---|---|
| [#993](https://github.com/boosterchile/booster-ai/pull/993) | `f3caf468` | **BARH-23** reclamar carga sin oferta (`POST /marketplace/viajes/:id/reclamar`); precio canónico del viaje |
| [#995](https://github.com/boosterchile/booster-ai/pull/995) | `4d7abe41` | **BARH-24** viaje propio: migración **0085**, `POST /viajes-propios`, UI `/app/viajes-propios/nuevo`, mezcla en rutas; guard IDOR vínculo comercial |
| [#996](https://github.com/boosterchile/booster-ai/pull/996) | `96bb7155` | IAM cursor-agent (ya aplicado en GCP) |
| [#997](https://github.com/boosterchile/booster-ai/pull/997) | `22f7f8fb` | docs handoff IAM |

**HEAD `main`**: `22f7f8fb`.  
**Prod (corte)**: imagen release BARH-21 `e0f3ccf4` (api revisión `00482-pch` tras env `EMAIL_FROM`; misma familia de imagen).  
**Gap de producto**: falta desplegar **0085 + claim + viaje propio + UI**.

Migración **0085** = expand-only (`origen_alta`, `cliente_externo_*`, `assignments.oferta_id` nullable).

## 2. Release canónico (PO)

```bash
gh workflow run release.yml --ref main
# Aprobar Environment `production`.
# Un solo run; no duplicar mientras hay canary.
```

Checklist gate:

- [ ] Run Release + Deploy sobre `main` @ `22f7f8fb` (o tip más nuevo solo-docs).
- [ ] Environment **production** aprobado por el PO.
- [ ] Canary api → 100 %; web y servicios verdes.
- [ ] Migración **0085** aplicada (86 migraciones en total si 0084 ya estaba).

**Cursor no ejecuta** este workflow.

## 3. Confirmación post-deploy

### 3.1 Revisiones + health

```bash
gcloud run services describe booster-ai-api \
  --project=booster-ai-494222 --region=southamerica-west1 \
  --format='value(status.latestReadyRevisionName)'
gcloud run services describe booster-ai-web \
  --project=booster-ai-494222 --region=southamerica-west1 \
  --format='value(status.latestReadyRevisionName)'

curl -sS https://api.boosterchile.com/health
curl -sS https://api.boosterchile.com/ready
curl -sS -o /dev/null -w 'web=%{http_code}\n' https://app.boosterchile.com/app/viajes-propios/nuevo
```

Esperado: revisión nueva ≠ solo-env `00482-pch` si el release construyó imagen nueva; health/ready 200; ruta viaje propio alcanzable (auth redirige OK).

### 3.2 Migración 0085

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'viajes' AND column_name IN (
  'origen_alta', 'cliente_externo_nombre', 'cliente_externo_rut', 'cliente_externo_contacto'
);
-- 4 filas

SELECT conname FROM pg_constraint
WHERE conname IN ('ck_viajes_origen_alta', 'ck_viajes_cliente_propio');
```

### 3.3 Flags (conservar)

```bash
gcloud run services describe booster-ai-api --region=southamerica-west1 \
  --format='yaml(spec.template.spec.containers[0].env)' \
  | grep -A1 -E 'MATCHING_ELEGIBILIDAD_MODO|RUTAS_API_ACTIVADA|EMAIL_FROM'
# Esperado: activa / true / Booster <contacto@boosterchile.com>
```

## 4. Checklist evidencia Score P (post-release)

Marcar en `docs/handoff/CURRENT.md` cuando haya evidencia. **No** cuenta intervención manual del PO como “autónomo”.

| # | Evidencia | Dimensión P | Cómo verificar |
|---|---|---|---|
| E1 | Release BARH-23/24 en prod | Matching / marketplace | Revisión + 0085 + UI |
| E2 | Invitado completa `/crear-cuenta` + login | Conductor/onboarding | Cuenta real (no solo mail enviado) |
| E3 | Conductor activado solo por WhatsApp/correo | Conductor autónomo | Sin código dictado por el PO |
| E4 | 1 viaje: asignado → recogida → entrega → cert **sin** parche PO | Flujo core | Query Slot 3 `frentes-vivos` |
| E5 | 1 `POST .../reclamar` o matching real en `activa` con log | Matching | Log `matching: elegibilidad por carga` u oferta/claim |
| E6 | 1 `POST /viajes-propios` → asignado + ruta 2 stops | Marketplace | Viaje `origen_alta=propio_transportista` |
| E7 | Viaje sin FMC150 con `*Actual` null + DQ (o valor) | Huella | Query Slot 1; nunca 0 silencioso |
| E8 | (Más tarde) 1 ciclo cobro técnico conciliado | Cobro técnico | Mandato runtime; no abogado |

Tras E1–E6: Score P ≈ **4–4.5**. E7→ huella 5. E8→ P **5**.

## 5. Smoke funcional mínimo (PO o usuario de prueba)

1. Transportista: `/app/viajes-propios/nuevo` → crear viaje propio (cliente externo o generador con vínculo).
2. Transportista: ofertas / marketplace → reclamar un viaje abierto de zona (precio > 0).
3. Conductor activado: recogida → GPS → entrega.
4. Confirmar certificado (secundario OK para Score P; primario CAN es bonus).

## 6. Rollback

- Canary/release: procedimiento canónico del workflow (revisión anterior).
- 0085 expand-only: no revertir columnas en caliente; feature se apaga no usando UI/API.
- Flags matching/rutas: no bajar a sombra/off salvo incidente.

## 7. Fuera de este oneshot (Score C)

Abogado, RFPs GLEC/pentest, contrato, precios ADR-079. No bloquean marcar Score P.

## 8. Después del release

1. Actualizar `docs/handoff/CURRENT.md` (tip prod, 0085, E1…).
2. Ir tachando E2–E8 con links/queries.
3. Agent puede ayudar a armar queries/logs; **no** opera el viaje ni dispara release.
