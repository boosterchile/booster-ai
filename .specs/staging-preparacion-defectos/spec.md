# Spec — Defectos de la preparación de staging (ADR-083)

- Fecha: 2026-11-23
- Estado: Vigente
- Programa: TRL 10, paso 6 del plan (`docs/handoff/2026-11-20-plan-trl10.md`); destraba T10-19, T10-20 y T10-21
- Decisión: [ADR-083](../../docs/adr/083-staging-gemelo-y-extraccion-con-shadow.md). Esta spec no la cambia.
- Permiso del PO en el chat (2026-11-23): «sí, arregla los tres defectos», para editar `infrastructure/networking.tf` (firewall) e `infrastructure/iam.tf` (IAM).

## Problema

Staging se gestiona con el mismo root module que prod. Una lectura de `main` (`fdc43f11`) encontró tres puntos donde la preparación solo funciona con los valores de prod. Staging todavía no existe, así que ninguno se había manifestado.

| # | Dónde | Defecto | Efecto en staging |
|---|---|---|---|
| 1 | `infrastructure/networking.tf`, regla de prioridad 390 de Cloud Armor | El host del API está escrito como `api.boosterchile.com` | La regla nunca coincide con `api.staging.boosterchile.com` y el API queda detrás de las reglas OWASP que la regla existe para evitar |
| 2 | `infrastructure/iam.tf`, cinco bindings de `cursor-agent@` | La SA se creó a mano en prod; Terraform solo declara sus permisos | La SA no existe en el proyecto gemelo y GCP rechaza un binding a una SA inexistente: el `apply` falla |
| 3 | `.github/workflows/release-staging.yml` | `STAGING_URL` se usa como URL del API; `e2e-staging.yml` la usa como URL de la PWA | El balanceador sirve `api.` y `app.` por separado: cualquier valor rompe el deploy o el E2E |

## Salidas

1. La regla de Cloud Armor compara contra `api.${var.domain}`.
2. Los cinco bindings de `cursor-agent@` llevan `count = local.cursor_agent_enabled ? 1 : 0`, con `cursor_agent_enabled = var.environment == "prod"`, y un bloque `moved` por recurso hacia el índice `[0]`. El custom role `cursorAgentSchedulerWriter` se sigue creando en los dos entornos: no depende de la SA.
3. `release-staging.yml` lee la variable de repositorio nueva `STAGING_API_URL` para `_PUBLIC_API_HOST`, `_VITE_API_URL` y el smoke de `/health`, y la valida en su primer paso. `STAGING_URL` queda como URL de la PWA. `e2e-staging.yml` no se toca.
4. Runbook, checklist, `docs/ci-cd.md`, `infrastructure/README.md` y `CURRENT.md` nombran las dos variables.

## Criterios de éxito

- [ ] `terraform fmt -check -recursive infrastructure/` sale 0.
- [ ] `terraform validate` del root module sale válido.
- [ ] En prod, el `plan` posterior al merge no trae altas, cambios ni bajas por este PR: el texto de la expresión de Cloud Armor es idéntico y los cinco recursos se mueven a `[0]` sin recrearse. **Lo verifica el Terraform Drift Check** de prod; desde esta sesión no se puede correr un `plan`.
- [ ] La validación de `STAGING_API_URL` acepta `https://api.staging.boosterchile.com` y rechaza el valor vacío, uno sin `https://` y uno con slash final.
- [ ] Mientras `STAGING_PROJECT_ID` no exista, «Deploy staging» se sigue omitiendo.

## Fuera de alcance

- Crear el proyecto, la facturación, el `apply`, los secretos y las variables de GitHub: son del PO (ADR-083 §1).
- El `plan` de staging: necesita `billing_account` y permisos que la sesión no tiene. Puede haber más defectos que solo aparezcan ahí.
- El bucket de state compartido: la SA de drift de staging puede leer también el state de prod. Queda declarado en el runbook.
- El job de drift de staging: entra cuando staging exista.

## Revisión de seguridad (2026-11-23)

Los revisores automáticos no corrieron sobre #1050, así que el agente lo revisó a pedido del PO («sí, haz la revisión de seguridad de #1050»; «sí, corrige los dos en un PR»). #1050 no empeoró nada. Aparecieron dos hallazgos:

| # | Severidad | Hallazgo | Arreglo |
|---|---|---|---|
| 4 | Media | El state de prod guarda la contraseña de Postgres en texto plano (`data.tf` arma `DATABASE_URL`). Staging compartía el bucket y su SA de drift recibía `objectViewer` sobre el bucket entero: cualquier identidad capaz de usar esa SA habría leído la credencial de prod. Viene de la preparación original, no de #1050 | Bucket de state propio para staging, `booster-ai-tfstate-stg-494222`, declarado en `infrastructure/tfstate-staging.tf` y creado por el `apply` de prod. `backend.hcl` y el tfvars de staging apuntan a él. `iam.tf` no cambia: el binding sigue a `var.tfstate_bucket`, que en staging ya es el bucket propio |
| 5 | Baja | La validación de `STAGING_API_URL` aceptaba query, fragmento, usuario, puerto y comas. La coma permite colar otra sustitución en `--substitutions` | El paso exige `https://` más un nombre de host, anclado al valor completo |

Se descartó restringir el permiso por prefijo con una condición de IAM: el listado de objetos se evalúa contra el bucket y no contra el objeto, la sesión no puede probarlo contra GCP y un error dejaría al Drift Check de prod sin leer su state.

### Criterios de éxito

- [ ] `terraform fmt` y `terraform validate` en verde.
- [ ] El paso de validación, ejecutado tal como está en el workflow, acepta `https://api.staging.boosterchile.com` y rechaza vacío, ruta, query, fragmento, usuario, puerto, coma, salto de línea, `http://` y un host sin punto.
- [ ] El `plan` de prod posterior al merge muestra una sola alta, `google_storage_bucket.tfstate_staging[0]`. **Lo verifica el PO al aplicar**; el Drift Check queda en rojo hasta ese `apply`.
- [ ] Ninguna identidad de staging tiene un binding sobre `booster-ai-tfstate-494222`.
- [ ] Guarda: con `environment = "staging"` y `tfstate_bucket` igual al bucket de prod, `terraform plan` falla en la validación de la variable.

