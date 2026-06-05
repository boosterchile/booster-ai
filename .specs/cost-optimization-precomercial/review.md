
# Devils-advocate review — cost-optimization-precomercial — 2026-06-05T21:15:18Z

## Premise
- Asumido: "pre-comercial <=10 camiones => no se necesita HA/redundancia". Premisa razonable pero no verificada contra contratos firmados: el spec dice "SLA que aun no tiene clientes asociados" pero no cita evidencia (ni un contrato, ni un correo del PO confirmando que NINGUN cliente actual exige 99.9%). Si existe un piloto pagado con expectativa de uptime, A1/D/C1 lo violan.
- Asumido: "todo es reversible con un flip de variable". Falso para A1 (Redis) y parcialmente para D: el spec mismo admite que A1 RECREA la instancia y cambia `host`; D cambia `availability_type` in-place pero el camino de vuelta REGIONAL->ZONAL->REGIONAL no es instantaneo ni gratis. "Reversible" no es lo mismo que "reversible sin downtime".
- Mas doloroso si es falso: que exista un cliente/piloto con expectativa de disponibilidad. Colapsa la justificacion de 4 de 6 palancas.

## Scope and second-order effects
- DR cold (C1) interactua con `cloudbuild-dr-check.yaml` y `cloudbuild-dr-deploy.yaml` (infrastructure/k8s/). El deploy DR (`cloudbuild-dr-deploy.yaml:142`) espera la IP `136.116.208.86` del LoadBalancer. Con `replicas: 0` + `externalTrafficPolicy: Local`, el Service DR no tiene endpoints sanos => el L4 LB no tiene backend healthy. Nadie verifico si el pipeline DR pasa o si futuros `apply` del DR fallan. No consultado.
- `externalTrafficPolicy: Local` + replicas 0 (telemetry-tcp-gateway-dr.yaml:185): con Local, el health check del LB solo pasa en nodos que corren un pod. Con 0 pods, 0 nodos sanos => el LB DR queda permanentemente unhealthy. El device Teltonika usa `telemetry-dr.boosterchile.com:5061` como Backup (cert-dr.yaml:8): si el primary cae, el device hace failover al backup tras 5 timeouts => conecta a un LB sin backends => conexion rechazada/colgada. El RTO no es "15-40 min runbook"; durante esos 15-40 min el device NO tiene a donde ir. Eso no es DR latente, es DR ausente. El spec lo vende como "base DR latente" (C2): enganoso.
- A2 (api min 1->0) elimina el ternario `var.environment == "prod"` (compute.tf:69). Antes prod tenia garantia de 1 instancia caliente; ahora prod = no-prod = 0. Hyrum: cualquier health-check externo, uptime monitor o cron que pegue al `/health` del api paga cold start de 5-10s. Si hay un uptime check de GCP Monitoring con timeout < 10s, generara falsas alertas de downtime. No verificado.
- Quitar `log_connections`/`log_disconnections` (A3): el security-auditor Booster (agents/security-auditor.md) exige compliance Ley 19.628 + retencion SII/DTE 6 anos. `log_connections` es senal de auditoria de acceso a BD; eliminarlo reduce capacidad forense ante acceso no autorizado. No se evaluo si alguna politica de compliance lo consume. (Verifique: no hay alerta en *.tf que los referencie hoy, pero ausencia de alerta no es ausencia de requisito de compliance.)

## Alternatives discarded
- Considerado en spec: ninguna alternativa por palanca; el spec toma el "paquete Optimizar Costos" como dado.
- No considerado (debio estarlo):
  1. A2: min_instances=1 solo para `service_api` (el critico) y 0 para los 6 services secundarios. Captura ~85% del ahorro sin exponer el endpoint principal a cold starts. El diff puso TODO a 0.
  2. D: en vez de REGIONAL->ZONAL, mantener REGIONAL y bajar el `tier`. El spec no muestra el desglose de costo REGIONAL-vs-tier; quiza el ahorro real venia del tier, no del availability_type. Sin ese numero, bajar availability es a ciegas.
  3. C1: `replicas: 1` sin HPA en vez de 0. Mantiene el LB con backend sano y failover real del device, a costo de 1 pod Autopilot. El ahorro marginal de 1->0 no justifica romper el failover.

## Failure modes
- F1 (Caida de zona Cloud SQL, post-D): deteccion = alertas de conexion BD fallida (si existen). Recuperacion = restore desde backup/PITR, "minutos-1h". Costo: producto caido esa hora + posible perdida de datos entre ultimo backup y la caida (RPO no declarado). El spec no declara RPO.
- F2 (Caida regional + failover device a DR, post-C1): deteccion = device hace 5 timeouts y switchea. Recuperacion = NINGUNA automatica; DR tiene 0 pods => device conecta a LB sin backend. Costo: perdida total de telemetria hasta que un humano corra el runbook. Es el escenario exacto que dr-region.tf:16 dice que justifico el DR ("hubo 1 caida en 2024 y 1 en 2025").
- F3 (Rolling update gateway primary con 1 replica, post-B1): el deployment NO tiene `strategy:` explicito (verifique: 0 ocurrencias en telemetry-tcp-gateway.yaml) => default RollingUpdate maxUnavailable 25%. Con 1 replica puede tumbar el unico pod antes de que el nuevo este Ready => corte TCP de los Teltonika en CADA deploy de imagen. El comentario admite "breve corte" pero no se anadio `strategy: Recreate` ni se cuantifico.
- F4 (Redis BASIC recreacion, A1): si algun proceso usa Redis para correctness (locks distribuidos, idempotencia de matching) y no solo cache, la ventana de recreacion puede causar doble-procesamiento. No evaluado.

## Reversibility
- Costo de deshacer en 30 dias: ALTO para A1 (otra recreacion de Redis + cambio de host + re-deploy Cloud Run) y MEDIO-ALTO para D (cambio de availability_type, ventana). BAJO para A2/B1. MEDIO para C1 (recrear HPA + scale-up + esperar cert/pod).
- Mecanismo: flip de variable + apply. PERO al borrar el ternario `var.environment == "prod"` en compute.tf:69 y data.tf:120 se perdio la diferenciacion prod-HA / dev-ZONAL. Con ADR-055 (entorno de desarrollo separado) ya existente, prod y dev compartiran `cloudsql_high_availability=false` salvo que se re-introduzca logica por entorno. Regresion de diseno.
- NO hay ADR. Se bajan 4 contratos de disponibilidad (Redis HA, Cloud SQL REGIONAL, gateway redundancia, DR failover). CLAUDE.md exige ADR cuando "cambio un patron que aplica a multiples modulos" y para desviar del stack. Pasar de "disenado para 99.9% / 1k-10k devices" a "single-zone, single-replica, sin DR" ES cambio de patron arquitectonico.

## Drift signals
- "pre-comercial" / "Volver a ... al firmar B2B" se repite como justificacion en variables.tf:163/172, compute.tf:65, dr-yaml. Es la version Booster del vocabulario de aplazamiento. El gatillo "firmar B2B con SLA" no tiene owner ni tracking; no hay stub en `.specs/_followups/` que diga "revertir cost-opt al cliente N". Sin eso, el aplazamiento se vuelve permanente. Objecion: crear el follow-up de reversion ligado a un evento de negocio.
- verify.md:13 dice V2 "bloqueado por creds" y verify.md:31 muestra V2 corrido. Estado contradictorio en el mismo doc. Menor pero indica edicion apresurada.

## Evidence quality
- Claim "ahorra ~CLP 350-450k/mes (-45%)" -> Evidencia: ninguna en los artefactos (viene del paquete no incluido). Verdict: ABSENT. Sin desglose por palanca no se sabe si el grueso del ahorro viene de palancas baratas y de bajo riesgo o de las 4 que rompen disponibilidad.
- Claim "Cloud SQL es update in-place, no replace" -> Evidencia: terraform plan (verify.md:36). Verdict: SUFICIENTE (unico load-bearing con evidencia real).
- Claim "cache medido practicamente vacio" (variables.tf:172) -> Evidencia: "medido" sin cita. Verdict: WEAK. Si Redis tiene locks/idempotencia, "vacio" es irrelevante para el riesgo de correctness en la recreacion.
- Claim "RTO 15-40 min" DR (dr-yaml:42) -> Evidencia: ninguna; sin runbook ejecutado ni drill. Verdict: ABSENT + contradicho por el hallazgo de LB DR sin backend.
- Claim "rolling update puede tener breve corte" -> Evidencia: vibes; no medido, sin Recreate. Verdict: WEAK.

## Verdict
- Strong objections (must address):
  1. DR queda funcionalmente roto, no "latente" (C1 + externalTrafficPolicy: Local + replicas 0): el failover del device Teltonika apunta a un LB sin backend sano, contradiciendo dr-region.tf. O `replicas: 1` en DR, o documentar explicitamente que NO hay failover y aceptarlo con firma del PO.
  2. Falta ADR para bajar 4 contratos de disponibilidad simultaneos (CLAUDE.md lo exige para cambio de patron multi-modulo).
  3. Plan contaminado / `-target` peligroso: verify.md:49 dice que `apply opt.plan` arrastra teardown SEC-001 + downgrade de IAM humana (prohibido por CLAUDE.md). Aislar con `-target` es un smell: salta el grafo de dependencias, puede dejar el state inconsistente y NO resuelve que el proximo apply full re-arrastrara el drift. La pregunta correcta no es "como aislo con -target" sino "por que el state de prod no refleja SEC-001 marcado como Shipped" (drift-findings #1, posible hueco de seguridad). Resolver el drift ANTES, no sortearlo.
  4. Borrar el ternario `var.environment` (compute.tf:69, data.tf:120) elimina la diferenciacion prod/dev justo cuando ADR-055 introduce un entorno separado. Conservar capacidad por-entorno o documentar la regresion.
- Residual risks (accept and document):
  - Cold starts en api (A2): aceptable si no hay uptime check con timeout corto; verificar.
  - Perdida de `log_connections` para forense de acceso BD: que lo confirme security-auditor contra Ley 19.628.
  - Corte TCP en rolling update del gateway (1 replica): aceptar con `strategy: Recreate` explicito o cuantificar el corte.
  - RPO/RTO de Cloud SQL ZONAL no declarado: documentar el peor caso de perdida de datos.
- Out of scope: el detalle de costo CLP por palanca (no provisto) y la ejecucion del runbook humano de apply.

---

# Resolución (2026-06-05, post-decisión PO)

**code-reviewer** dio `REQUEST_CHANGES` (4 blockers); **devils-advocate** 4 strong objections. Resolución:

## Blockers resueltos en código/docs
- ✅ **Falta ADR** (DA#2, CR-consistency) → **ADR-058** creado (supersede ADR-035, decisión PO: reclasificación a pre-comercial). ADR-035 marcado Superseded. Premisa "sin contratos B2B" confirmada por el PO (resuelve también la objeción DA-premise).
- ✅ **`terraform.tfvars.example` stale** (CR-blocking) → `redis_tier = "BASIC"` + añadida `cloudsql_high_availability = false` con comentarios de reversión.
- ✅ **`verify.md` contradictorio** (DA drift-signal, CR) → corregido; V2 ejecutado tras reauth.
- ✅ **Diferenciación por entorno** (DA#4, CR): `data.tf` ahora usa `var.cloudsql_high_availability` (per-entorno vía tfvars) → **restaura** capacidad por-entorno (mejor que el ternario). `compute.tf` min_instances=0 es decisión deliberada pre-comercial (dev ya era 0; solo prod cambia 1→0).
- ✅ **Gatillo de reversión sin tracking** (DA drift-signal) → stub `_followups/revertir-ha-al-firmar-b2b-sla.md` ligado al evento "firmar primer B2B con SLA".
- ✅ **dr-region.tf narrativa contradictoria** (CR-question) → comentario actualizado apuntando a ADR-058 (estado cold).

## Riesgos aceptados por el PO (ADR-058 §Negativas) — documentados, no bloqueantes
- **DR funcionalmente cold, no failover automático** (DA#1, F2): aceptado explícitamente en ADR-058. `replicas: 0` se mantiene; el device Teltonika NO tiene failover regional hasta reactivación manual (RTO 15-40 min). `cloudbuild-dr-deploy.yaml` healthcheck quedará rojo en DR — esperado mientras DR esté cold.
- **A1 recrea Redis = ventana de 503 en auth** (F4, NUEVO hallazgo): Redis sostiene rate-limit **fail-closed** (`rate-limit-pin` /auth/driver-activate, `rate-limit-signup`). Durante la recreación esos endpoints dan 503. ⇒ Aplicar A1 en ventana baja real; esperar 503 transitorio en driver-activate/signup. No es "caché vacío sin impacto".
- **Cold starts api** (A2): aceptado; verificar que ningún uptime check tenga timeout <10s antes de aplicar.
- **Rolling update gateway 1 réplica** (F3): el default RollingUpdate (maxSurge 25%→1, maxUnavailable→0) **surge antes de matar**, así que el rollout no tumba el pod; pero con 1 réplica las conexiones TCP persistentes se reconectan en cada deploy (Teltonika auto-reconecta). Aceptado; no se añade `strategy: Recreate` (sería peor: mata-antes-de-crear).
- **Pérdida `log_connections`/`log_disconnections`** (MINOR): Cloud Audit Logs + `cloudsql.iam_authentication` siguen activos (forense de acceso independiente de estos flags Postgres). Aceptado para pre-comercial.
- **RPO/RTO Cloud SQL ZONAL**: RPO ≈ continuo (PITR transaction logs, retención 7d) → pérdida de datos cercana a cero; RTO = restore (minutos-1h). Documentado.

## Apply (no en este PR)
- `terraform apply opt.plan` completo PROHIBIDO (arrastra SEC-001 + IAM). Aplicar **palanca por palanca con `-target` explícito** de los recursos de costo, o reconciliar el drift SEC-001/IAM primero (issues separados). Detalle en `drift-findings.md`. El PR solo aterriza CÓDIGO; el apply es paso humano separado.

**Veredicto post-resolución:** blockers de merge resueltos. Apto para PR (no para apply automático).
