# Runbook — `terraform apply` seguro (con foco en secrets validados)

Origen: post-mortem **INC-2026-06-19** (un `terraform apply` creó el secret
`content-sid-safety-alert` con su placeholder `ROTATE_ME_*` y lo montó en
`service_api` → `config.ts` lo valida `^HX[a-fA-F0-9]+$` → el placeholder no matchea
→ `parseEnv` **"Refusing to start"** → la revisión nueva no llegó a READY → deploys
bloqueados; sin impacto a usuarios porque Cloud Run no enruta a una revisión que no
arranca). Este runbook fija la disciplina que evita repetirlo.

## TL;DR — el flujo en 4 pasos

```bash
cd infrastructure
terraform plan -out=tf.plan                 # 1. plan a archivo
terraform show -json tf.plan > plan.json    # 2. JSON para el preflight
node ../scripts/repo-checks/check-validated-secret-placeholders.mjs plan.json  # 3. GATE
#    ↑ exit 0 = ok; exit 1 = un secret validado quedaría placeholder + montado → ABORTAR
terraform apply tf.plan                     # 4. aplicar EXACTAMENTE el plan revisado
```

Nunca `terraform apply` directo sin revisar el plan completo. Nunca aplicar un plan
que el preflight (paso 3) rechaza.

## Regla de oro — secrets validados por formato

Un secret se llama **"validado por formato"** si `apps/api/src/config.ts` lo valida con
un `.regex(...)` (hoy: `content-sid-*` → `^HX…`, `twilio-account-sid` → `^AC…`). Para
estos, el sentinel `ROTATE_ME_*` que crea `security.tf` es **NO-vacío** y **no matchea
la regex** → montarlo tumba el startup.

**Por eso, para un secret validado nuevo:**

1. **Crear el secret** (agregarlo a `local.secret_names` en `security.tf`). Esto crea el
   shell + su placeholder `ROTATE_ME_*`. **No lo montes todavía.**
2. **Cargar el valor real** ANTES de montarlo:
   ```bash
   gcloud secrets versions add <nombre> --data-file=<(printf '%s' 'HX...')
   ```
   (para content-sids, ver también `load-content-sids.md`).
3. **Montar + activar**: agregar el env var a `local.content_sid_secret_names`
   (compute.tf) y poner `"<nombre>" = true` en el default de `var.content_sid_ready`
   (variables.tf). Hasta que el flag sea `true`, el mount **no ocurre** (control A7):
   la env var queda ausente → `config.ts` la trata como `undefined` (`.optional()`) →
   el service arranca, la feature queda inactiva.
4. `terraform plan` debe seguir **No changes** para los secrets ya activos; el nuevo
   aparece como un `create` del version + (si `ready=true`) el mount.

> Apply en dos pasos a propósito: el placeholder **nunca** llega a montar-y-tumbar.
> El preflight (gate del paso 3, también cableado en `terraform-drift.yml`) es la red
> de seguridad si alguien se salta esta disciplina.

## Reconciliar drift — `-target` acotado

Cuando el drift-check (`.github/workflows/terraform-drift.yml`) marca diff:

- Aplicar **solo lo que querés reconciliar** con `terraform apply -target=<recurso>`
  (uno o pocos), **no** un apply global que barra drift ajeno. El INC ocurrió porque un
  apply arrastró la creación del `content-sid-safety-alert` junto con otra cosa.
- **NO tocar** IAM Owner / Billing sin revisión humana (ver #410/#411; el swap solía ser
  un phantom de `tfvars` local).
- Tras reconciliar, correr `terraform plan` global y confirmar **No changes**.

## Notas

- El agente NO corre `terraform apply` (credenciales = owner). El owner aplica y verifica
  que la revisión nueva quede READY y sirviendo (health 200) tras tocar secrets.
- Comentarios engañosos corregidos (A6): un placeholder `ROTATE_ME_*` montado **NO**
  "degrada a solo-push" — falla el arranque. Solo el valor ausente (no montado, A7) o
  vacío degrada graceful.
