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

## Corrida en seco del plan de staging (2026-11-23)

El agente corrió `terraform plan` contra el backend de staging, en solo lectura y sin lock, con el tfvars de ejemplo y un `billing_account` de relleno.

```
Plan: 421 to add, 0 to change, 0 to destroy.
```

- Solo altas. Ninguna mención de `booster-ai-494222` ni de su número de proyecto.
- Proyecto `booster-ai-stg-494222`, Cloud SQL `db-custom-1-3840` zonal, Redis `BASIC` de 1 GB, zona DNS `staging.boosterchile.com.`, ocho servicios de Cloud Run con la imagen placeholder.
- Ningún binding de `cursor-agent@`; el binding de lectura del state apunta a `booster-ai-tfstate-stg-494222`.

El chequeo `check-validated-secret-placeholders.mjs` sobre ese plan falló y destapó un sexto defecto:

| # | Severidad | Hallazgo | Arreglo |
|---|---|---|---|
| 6 | Media (rompe el primer deploy) | `content_sid_ready` tiene por defecto los cinco content-sid en `true`, porque en prod ya tienen valor real. El tfvars de ejemplo decía heredar el default. En staging nacen con `ROTATE_ME_*`, que no pasa la validación `^HX` del api: el primer deploy real no arranca | `content_sid_ready = {}` en el tfvars de ejemplo |

`twilio-account-sid` no tiene compuerta y se monta siempre en api, notification-service y whatsapp-bot. No se toca el Terraform: el runbook pide cargarlo con un valor de prueba antes del primer deploy.

### Criterios de éxito

- [ ] Con el tfvars de ejemplo corregido, el chequeo de placeholders lista solo `twilio-account-sid`.
- [ ] El plan sigue en 421 altas, sin cambios ni bajas (los montajes son atributos del servicio, no recursos).

### Sin verificar

- El `apply`. Un plan limpio no garantiza que GCP acepte las 421 altas: disponibilidad del ID del proyecto, cuotas, políticas de la organización y propagación de APIs solo se ven al aplicar.

## Primer `apply` de staging (2026-11-23, corrido por el PO)

Creó cuatro recursos `random_*` en el state y se detuvo en `google_project.booster_ai`:

```
Error: failed pre-requisites: failed to check permissions on billing account
"billingAccounts/XXXXXX-XXXXXX-XXXXXX": googleapi: Error 400:
Project 'projects/booster-ai-stg-494222' not found or deleted.
  "service": "cloudbilling.googleapis.com", "reason": "USER_PROJECT_DENIED"
```

Dos causas, independientes:

1. El `terraform.tfvars` local seguía con el `billing_account` de relleno. Es del PO.
2. **Defecto 7.** `versions.tf` fija `billing_project = var.project_id` con `user_project_override = true`: cada llamada se factura contra el proyecto del entorno. En el primer `apply` ese proyecto no existe, así que la primera llamada falla aunque el `billing_account` sea correcto. El plan no lo detecta porque no hace esa llamada. Prod no lo sufrió porque su proyecto ya existía.

| # | Severidad | Hallazgo | Arreglo |
|---|---|---|---|
| 7 | Alta (bloquea el primer `apply`) | El proveedor usa como proyecto de cuota el proyecto que el mismo `apply` tiene que crear | Variable `quota_project_id` (por defecto `null`, es decir el propio proyecto). El tfvars de staging la fija en `booster-ai-494222` durante el arranque; se quita al terminar el primer `apply` |

### Criterios de éxito

- [ ] `terraform validate` en verde y el plan de staging sigue en solo altas.
- [ ] En prod, `quota_project_id` queda en `null`: la configuración del proveedor no cambia y el plan no muestra diferencias.
- [ ] **Lo verifica el PO:** el `apply` de staging pasa de `google_project.booster_ai`.

### Sin verificar

- Que no queden otros bloqueos de arranque después de este. La sesión no puede aplicar; cada uno solo aparece cuando el `apply` del PO llega a ese recurso.

## Tropiezos del primer `apply` completo (2026-11-24)

Con el proyecto de cuota resuelto, el `apply` del PO creó el proyecto y casi todo lo demás. Fallaron ocho recursos por tres causas de orden, que en prod nunca aparecieron porque su proyecto ya tenía todo activado. El PO los resolvió repitiendo el `apply` y con un comando manual. Permiso del PO en el chat para corregirlos en Terraform, incluidos los archivos protegidos: «sí, corrige en Terraform los tres tropiezos del arranque».

| # | Error | Causa | Arreglo |
|---|---|---|---|
| 8 | `The project booster-ai-stg-494222 has not enabled BigQuery` en cinco datasets | Los datasets no dependían de la habilitación de APIs | `depends_on = [google_project_service.apis]` en los cinco (`data.tf`) |
| 9 | `Service account service-<n>@gcp-sa-pubsub.iam.gserviceaccount.com does not exist` en dos bindings | El agente de Pub/Sub no existe en un proyecto nuevo hasta que se lo pide. Cuatro bindings lo nombran; dos pasaron por azar de orden | `google_project_service_identity.pubsub` (`service-identities.tf`) y `depends_on` en los cuatro bindings (`messaging.tf`) |
| 10 | `Identity Pool does not exist (booster-ai-stg-494222.svc.id.goog)` | El binding de cert-manager no dependía del clúster, que es quien crea el pool | `depends_on = [google_container_cluster.telemetry]` (`wave-3-tls.tf`) |

El texto de cada `member` no cambia: se agrega solo la dependencia, para que Terraform no vea un valor «conocido después del apply» y recree los bindings.

### Criterios de éxito

- [ ] `terraform fmt` y `terraform validate` en verde.
- [ ] Plan contra el state de staging: una sola alta, `google_project_service_identity.pubsub`.
- [ ] Plan contra el state de prod: la misma alta y ningún cambio en los datasets, los cuatro bindings de Pub/Sub ni el de cert-manager.
- [ ] **Lo verifica el PO:** los dos `apply`. Crear la identidad donde ya existe no cambia nada en GCP.

### Sin verificar

- **Un `apply` desde cero.** Es la única prueba real de estos arreglos y la sesión no puede hacerla. Puede haber otros problemas de orden que en esta corrida no aparecieron por azar.
- **Por qué `google_bigquery_table.crash_events` quedó marcada como a medio crear.** El error de esa corrida no llegó a la sesión. Se resolvió con `terraform untaint`; la causa queda sin determinar y este PR no la toca.

