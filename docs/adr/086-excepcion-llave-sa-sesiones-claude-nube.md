# ADR-086 — Una llave de SA de solo lectura para las sesiones de Claude en la nube

**Estado**: Propuesto (2026-10-23). Pasa a Aceptado con el merge del PR #833.
**Fecha**: 2026-10-23
**Decider**: Felipe Vicencio (Product Owner). Aceptó el riesgo en la spec §6 («opción B») y pidió este ADR el 2026-10-23.
**Acota a**:
- [ADR-001](./001-stack-selection.md), fila «CI / GCP»: elige Workload Identity Federation y descarta la llave JSON de SA por la lección de SEC-2026-04-01 («nunca descargar SA keys»). Este ADR abre **una** excepción a esa regla. CI, runtime y operadores siguen sin llaves.

No supersede a ADR-001: todo lo demás sigue vigente.

**Relacionado**: [`docs/ci-cd.md` §Autenticación GCP](../ci-cd.md), auditoría de costos GCP de 2026-10 (`.specs/presupuesto-clp/`).
**Spec y runbook**: `.specs/acceso-gcp-sesiones-nube/spec.md`

---

## Contexto

Las sesiones de Claude Code en la nube no pueden leer GCP. La auditoría de costos de 2026-10 lo comprobó por tres caminos y los tres fallaron (spec, «Origen»): el token del proxy sin credencial configurada, una llave de SA bloqueada por la org policy y el conector BigQuery con el OAuth roto.

Estado de la org policy, verificado el 2026-10-23:

| Constraint | Org `435506363892` | Efectiva en `booster-ai-494222` |
|---|---|---|
| `iam.disableServiceAccountKeyCreation` | `enforce: true` | `enforce: true` (heredada) |
| `iam.managed.disableServiceAccountKeyCreation` | sin política | `enforce: false` |

El entorno de Claude en la nube acepta un **Network secret** de tipo «GCP access token (with Service Account Key)» para los hosts `*.googleapis.com`. El proxy de Anthropic guarda la llave y firma cada request. El contenedor solo ve el placeholder `CLOUDSDK_AUTH_ACCESS_TOKEN=proxy-…`. Ese mecanismo pide una llave de SA. La spec no encontró una variante federada.

## Decisión

### 1. Alcance de la excepción

La regla de ADR-001 sigue igual para todo uso salvo uno: **una** llave del SA `claude-cloud-readonly`, guardada solo como Network secret del entorno de Claude. Cualquier otra llave de SA en el proyecto viola este ADR.

### 2. Org policy por proyecto

`google_org_policy_policy.allow_sa_keys` (`infrastructure/org-policies.tf`) fija `enforce = "FALSE"` para `iam.disableServiceAccountKeyCreation` solo en `booster-ai-494222`. Sigue el mismo patrón que `allow_public_iam`. Los demás proyectos de la org siguen bloqueados.

La constraint se evalúa por proyecto, así que la excepción no se puede acotar a un solo SA (ver Consecuencias).

### 3. SA de solo lectura

`google_service_account.claude_cloud_readonly` (`infrastructure/iam.tf`) con:

| Rol | Para qué |
|---|---|
| `roles/viewer` | get/list de recursos, logs y datos (ver Consecuencias) |
| `roles/bigquery.jobUser` | correr `bq query` |
| `roles/serviceusage.serviceUsageConsumer` | `serviceusage.services.use` para las llamadas a APIs |
| `roles/billing.viewer` sobre `019461-C73CDE-DCE377` | leer la cuenta de facturación. Se otorga por `gcloud` (runbook §4), porque el SA de drift no lee IAM de facturación y en Terraform sería drift perpetuo |

Ninguno otorga escritura. `roles/viewer` no incluye `secretmanager.versions.access`, `storage.objects.get` ni `iam.serviceAccountKeys.create` (verificado el 2026-10-23).

### 4. Custodia de la llave

- Se crea a mano con `gcloud iam service-accounts keys create` y se carga como Network secret del entorno **Default** de Claude.
- El archivo local se borra apenas queda cargado.
- Nunca va a Terraform (quedaría en el state), al repo, a variables de entorno del entorno de Claude ni a un chat.

### 5. Rotación, revocación y control

- **Rotación anual**: crear una llave nueva, reemplazar el Network secret y borrar la llave anterior (spec §5).
- **Revocación**: borrar el Network secret y las llaves del SA. El SA puede quedar sin llaves.
- **Control en cada rotación**: la única llave `USER_MANAGED` del proyecto debe ser la de `claude-cloud-readonly`.

  ```bash
  for sa in $(gcloud iam service-accounts list --project=booster-ai-494222 --format='value(email)'); do
    gcloud iam service-accounts keys list --iam-account="$sa" --managed-by=user --format='value(name)' \
      | sed "s|^|$sa  |"
  done
  ```

  Si aparece otra llave, se borra y se revisa quién la creó en los logs de auditoría (`CreateServiceAccountKey`).

  Línea base al 2026-10-23, antes del apply: 14 SA y 0 llaves `USER_MANAGED`.

## Alternativas consideradas

- **Workload Identity Federation.** Es lo que ADR-001 pide. Requiere que el entorno de Claude emita una identidad federable hacia GCP. La spec no encontró esa opción en el formulario de Network secrets. No se adopta mientras no exista (ver Re-evaluación).
- **Token de corta vida pegado en la sesión** (`gcloud auth print-access-token`). Vence en una hora, hay que regenerarlo a mano en cada sesión y queda dentro del contenedor y del chat. Descartado.
- **Conector BigQuery por OAuth.** Está roto (ref. `ofid_8d7b76dd8ee1ce99`) y solo cubre BigQuery: no sirve para `gcloud` ni para las APIs REST.
- **Excepción temporal.** Se aplica `allow_sa_keys`, se crea la llave y se quita la excepción. Las org policies no son retroactivas, así que la llave ya creada sigue funcionando. Ventaja: el proyecto queda abierto a llaves solo durante unos minutos por año. Costo: dos applies en cada rotación. **No adoptada**: la spec §6 eligió la excepción permanente.
- **Roles acotados en vez de `roles/viewer`.** Por ejemplo, `bigquery.dataViewer` solo sobre `billing_export`, más `monitoring.viewer`, `run.viewer` y `logging.viewer`. Así no se leería Firestore ni los datasets de negocio. Costo: hay que ampliar los roles cada vez que una auditoría necesite otro recurso. **No adoptada**: la spec eligió `viewer`.

## Consecuencias

### Positivas

- Las sesiones en la nube leen GCP (`gcloud`, `bq`, REST) sin que la llave entre al contenedor.
- El acceso se corta sin cambiar código: se borra el Network secret o la llave.
- CI y runtime no cambian: siguen en WIF e identidad nativa.

### Negativas

- **La excepción vale para todo el proyecto.** Cualquier principal con `iam.serviceAccountKeys.create` puede crear llaves para cualquier SA del proyecto. En la policy IAM del proyecto (verificado el 2026-10-23) son `group:admins@boosterchile.com` (`roles/owner`) y el service agent de Google APIs (`roles/editor`, gestionado por Google). No se revisaron los roles heredados de la org. Lo mitiga el control del §5, no un candado.
- **Existe una llave de larga vida.** Si el Network secret o el proxy se comprometen, se lee todo lo que alcanza `roles/viewer`. Eso incluye datos, no solo metadata:
  - documentos de Firestore (`datastore.entities.get/list`);
  - tablas de los 6 datasets de BigQuery (`audit`, `billing_export`, `esg_analytics`, `matching`, `observatory`, `telemetry`): todos dan `READER` a `projectReaders`;
  - logs no privados (`logging.logEntries.list`);
  - metadata de secretos (no sus valores).

  Telemetría, auditoría y Firestore pueden contener datos personales (Ley 19.628). La spec §6 acepta este riesgo.
- **El drift check diario** marcará los recursos de este ADR como pendientes entre el merge y el apply.

## Validación

Criterios de la spec §3:

- **SC-1**: el plan acotado da 1 política, 1 SA y 3 bindings, sin cambios ni destrucciones. Verificado el 2026-10-23 (PR #833, «Evidencia»).
- **SC-2**: `keys create` funciona para `claude-cloud-readonly` y sigue fallando en otros proyectos de la org.
- **SC-3**: desde una sesión nueva en la nube, `gcloud projects describe booster-ai-494222` y un `bq query` al billing export responden, y `gcloud run services update …` falla con 403.
- **SC-4**: la llave no aparece en el repo, en el state ni en el contenedor.
- El control del §5 lista una sola llave.

## Re-evaluación

Se revierte, quitando el Network secret, las llaves y `allow_sa_keys` (el proyecto vuelve a heredar `enforce: true`), cuando pase cualquiera de estas cosas:

- el entorno de Claude ofrezca una credencial federada para GCP;
- las sesiones en la nube dejen de necesitar leer GCP;
- el control del §5 encuentre una llave que no sea la de `claude-cloud-readonly`.
