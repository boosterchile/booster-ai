# ADR-083 — Staging como proyecto gemelo y extracción de microservicios con shadow en prod

**Estado**: Vigente
**Fecha**: 2026-10-08
**Decider**: Felipe Vicencio (Product Owner). Encargo del 2026-10-08: "T10-21: realizar todos los cambios que sean necesarios y que no permitan que ADR-048 sea un obstáculo. Crear o modificar el ADR. Habilitar staging."
**Supersede a**:
- [ADR-048](./048-microservices-extraction-strategy.md):
  - §1 pasos 3 a 5: deploy, drill y mirroring en un staging que no existía;
  - §3: mirroring en prod rechazado;
  - §4: un sub-ADR por servicio;
  - §5 y la validación T9b: tabla de presupuesto previa.

  Se conservan el patrón de corte por flag (§1 pasos 2 y 6 a 8), el rechazo de un big-bang (§D) y el rechazo de un service mesh (§C).
- [ADR-055](./055-separate-development-environment.md): resuelve sus preguntas abiertas a, b, c y d **para staging**. El entorno de desarrollo local sigue en su propio ADR.

**Relacionado**: ADR-076 (gobernanza de operador único), ADR-082 (T10-21 del programa TRL 10), backlog `#STAGING-ENV`

---

## Contexto

ADR-048 fijó la extracción de `notification-service`, `matching-engine` y `document-service` como un *strangler* en cuatro pasos:

1. deploy a staging;
2. rollback drill en staging;
3. mirroring de 3 a 7 días en staging;
4. corte en prod por flag.

Ese camino nunca se pudo recorrer, por tres razones:

1. **Staging no existe.** El backlog `#STAGING-ENV` está abierto desde mayo de 2026. ADR-055 quedó en Draft con cuatro preguntas abiertas. La infraestructura es un único root module de Terraform que describe solo `booster-ai-494222`.
2. **Un staging sin tráfico no puede hacer mirroring.** El mirroring "en staging" que pide ADR-048 §1.5 supone que staging recibe tráfico parecido al de prod. Un proyecto gemelo vacío solo recibe el tráfico sintético de E2E y de seeds, así que comparar ahí no prueba lo que §2 quería probar: cargas reales, payloads reales, carreras reales.
3. **El volumen de prod hace trivial el costo del mirroring en prod.** ADR-048 §3 rechazó el mirroring en prod por costo no medido y dejó explícita la cláusula de revisión: "si T9b revela budget trivial, se revisita". Con menos de 10 camiones y tráfico pre-SLA (ADR-058 y ADR-082 §3), duplicar en modo *shadow* las llamadas de notificación y matching cuesta del orden de céntimos al día.

Además, ADR-048 §4 pide un ADR por servicio antes de empezar. Tres ADRs de mapeo de endpoints son documentación que una spec cubre igual de bien y sin bloquear.

## Decisión

### 1. Staging es un proyecto GCP gemelo, gestionado con el mismo root module de Terraform

- **Proyecto**: `booster-ai-stg-494222`, en la misma org y la misma cuenta de facturación. El ID se fija en `infrastructure/environments/staging/terraform.tfvars.example` y el PO lo confirma al crearlo.
- **Estructura Terraform** (ADR-055 pregunta b, opción 3): la misma configuración de `infrastructure/`, con su propio state y sus propias variables.
  - `terraform init -backend-config=environments/staging/backend.hcl` (prefijo de state `terraform/staging`).
  - `terraform plan -var-file=environments/staging/terraform.tfvars`.
  - Se descartan los workspaces de Terraform porque esconden el entorno activo. También se descarta un módulo nuevo por entorno, porque exige mover cientos de recursos de prod con `state mv`.
- **Alcance** (ADR-055 pregunta c): réplica completa, para que lo que se prueba en staging sea lo que corre en prod. Va con tamaños mínimos:
  - Cloud SQL `db-custom-1-3840` zonal;
  - Redis `BASIC` 1 GB;
  - Cloud Run con `min_instances = 0`;
  - presupuesto mensual propio.
- **Dominio**: `staging.boosterchile.com`, con zona DNS propia en el proyecto de staging y delegada desde la zona de prod (`var.staging_nameservers`, un registro NS en prod).
- **Datos**: staging no copia datos de prod. Se puebla con seeds y con el E2E. Ninguna PII de prod entra a staging.
- **Deploy**: `.github/workflows/release-staging.yml` despliega a staging en cada push a `main`, con la misma `cloudbuild.production.yaml` y las sustituciones de staging que vienen de las variables del GitHub Environment `staging`. El deploy a prod sigue manual, con gate humano (CLAUDE.md).
- **Reparto de tareas** (ADR-055 pregunta d):
  - El agente escribe Terraform, workflows y runbook.
  - El PO crea el proyecto, vincula la facturación y ejecuta el `terraform apply` de staging y el registro NS de prod.
  - El PO también carga los secretos (Terraform o consola) y la configuración de Firebase del proyecto nuevo.

  Todo está en `docs/runbooks/staging.md`, con lista de verificación y corrida en seco (ADR-076).

### 2. Extracción de microservicios: drill en staging y shadow en prod

Cada servicio (`notification-service`, `matching-engine`, `document-service`) sigue esta secuencia:

1. **Servicio con imagen propia** y tests ≥ 80/80/80/80, consumiendo el mismo contrato (shared-schemas) que hoy usa la lógica inline.
2. **Flags en el monolito**:
   - `<SERVICIO>_VIA_MICROSERVICE` (`booleanFlag(false)`) decide quién atiende;
   - `<SERVICIO>_SHADOW` (`booleanFlag(false)`) activa la llamada duplicada.
3. **Staging**: deploy y **rollback drill**. Se provoca la falla del servicio, se apaga el flag y se verifica que el monolito retoma con datos consistentes en menos de 5 min. El resultado queda en `docs/runbooks/rollback-drill-microservicios.md`.
4. **Shadow en prod** (de 3 a 7 días por servicio):
   - El monolito sigue respondiendo y además invoca al servicio en forma asíncrona, *fire-and-forget*, sin efectos visibles: el servicio corre en modo `dry-run`, sin enviar notificaciones ni escribir.
   - Se compara un hash de los campos relevantes y las divergencias se cuentan en la métrica `<servicio>_shadow_divergencias_total`.
   - El corte exige cero divergencias no explicadas en la ventana.
5. **Corte en prod** con `<SERVICIO>_VIA_MICROSERVICE=true`, por Terraform.
6. **Respaldo**: el monolito conserva el camino inline 2 semanas. Después se elimina en un commit aparte (igual que ADR-048 §1 pasos 7 y 8).

### 3. Documentación por servicio: una spec, no un ADR

El mapeo de endpoints y eventos, el contrato, el plan de rollout y los criterios del drill de cada servicio van en `.specs/microservicios-t10-21/spec.md`, una sección por servicio. Solo se escribe un ADR si un servicio **se desvía** de este patrón.

### 4. Presupuesto: se mide durante el shadow, no antes

T9b (tabla USD/semana previa) deja de ser requisito para empezar. El costo incremental se mide con la facturación del proyecto durante el shadow y se registra en el reporte del drill. Si supera USD 20/semana por servicio, el shadow se acorta a 3 días.

## Consecuencias

### Positivas

- T10-21 deja de estar bloqueado por un entorno inexistente y por tres ADRs previos.
- `#STAGING-ENV` se resuelve con la misma configuración que prod. El nightly E2E deja de pegarle a prod en cuanto exista `STAGING_URL`.
- El shadow en prod prueba con el tráfico real, que era lo que ADR-048 §2 buscaba y que un staging vacío no puede dar.
- El riesgo de cambiar prod sin pasar por un entorno previo (`docs/qa/migration-ordering.md`) queda cubierto: cada push a `main` pasa por staging antes del deploy manual a prod.

### Negativas

- **Costo recurrente de staging**: Cloud SQL mínimo, Redis BASIC, GKE Autopilot (fee de clúster USD 0,10/h más los pods del gateway), NAT y egress. Es del orden de USD 150–250/mes; lo acota `monthly_budget_usd` del tfvars de staging.
- **Paridad**: staging comparte código Terraform con prod, pero cada entorno tiene su propio state. Un cambio de `.tf` se aplica dos veces. El drift de staging se vigila con el mismo `terraform-drift.yml`, con un job por entorno cuando staging exista.
- **El shadow en prod agrega una llamada asíncrona** por evento durante la ventana. Es *fire-and-forget* y no toca la respuesta al cliente.

## Validación

- [ ] `terraform validate` del root module con las variables nuevas, y `terraform plan` de staging en seco registrado por el PO.
- [ ] Proyecto de staging creado, `apply` hecho y `https://api.staging.boosterchile.com/health` responde 200.
- [ ] `release-staging.yml` despliega un commit de `main` a staging.
- [ ] Por servicio: drill de rollback en staging y shadow sin divergencias en prod, documentados.
