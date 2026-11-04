# ADR-082 — El objetivo del producto vuelve a ser TRL 10, con definición verificable

**Estado**: Vigente
**Fecha**: 2026-10-07
**Decider**: Felipe Vicencio (Product Owner)
**Supersede a**: [ADR-058](./058-precomercial-rightsizing-disponibilidad-supersedes-035.md) en la clasificación del producto como pre-comercial. Sus palancas de infraestructura (SQL zonal, Redis `BASIC`, réplicas del gateway) siguen vigentes hasta el gatillo de su «Condición de reversión», que este ADR conserva. [ADR-081](./081-retiro-cluster-dr-frio.md) sigue vigente.
**Reemplaza como definición de término**: `.specs/production-readiness/spec.md` (2026-05-17), cuyos criterios quedaron parcialmente obsoletos por ADR-069, ADR-080 y ADR-081.
**Relacionado**: ADR-001 (requisito TRL 10 del cierre Corfo), ADR-012, ADR-021, ADR-036, ADR-048, ADR-076, ADR-077, ADR-079, ADR-080

---

## Contexto

ADR-001 fijó TRL 10 como requisito del cierre con Corfo: auditoría de seguridad profesional, coverage 80 %+, observabilidad APM completa, WCAG 2.1 AA y DR probado. ADR-035 lo confirmó. ADR-058 (2026-06-05) reclasificó el producto a pre-comercial porque no había contratos con SLA, y con eso dejó a TRL 10 sin vigencia. El informe del hito 2 de Corfo (2026-07-06) siguió citando TRL 10 como requisito de cierre. Los dos documentos no podían regir a la vez.

La consecuencia práctica de ADR-058 fue que el trabajo dejó de tener un estado final: la spec `production-readiness` siguió `Approved` con sus 30 criterios sin marcar, y varias funcionalidades comprometidas (extracción de microservicios, wake-word, eco-routing en tiempo real, observatorio) quedaron abandonadas en comentarios de código sin un ADR que lo dijera. La verificación del 2026-10-07 contra el repo encontró 0 de 30 criterios cumplidos tal como están escritos, ~5 cumplidos en sustancia y ~6 obsoletos por ADR posteriores.

La escala TRL estándar (NASA, UE) termina en 9. En Booster, «TRL 10» es la extensión que define ADR-001: sistema en operación comercial, certificado externamente y con la operación endurecida. Este ADR la vuelve verificable.

## Decisión

**1. El objetivo del producto es TRL 10.** Deja de ser pre-comercial. El trabajo se ordena como un programa con criterio de término, no como mejora continua.

**2. TRL 10 se declara cuando se cumplen todos los criterios de `.specs/trl10/spec.md`.** Esa spec es la única definición de término. Cada criterio es binario y lo puede verificar un tercero con un comando, un archivo o un registro de prod. Cambiar un criterio exige enmendar la spec con la decisión del PO registrada; quitar uno que dependa de un ADR exige un ADR que lo marque `No perseguido`.

**3. Disponibilidad y DR: DR por restauración, HA al primer SLA.**
- El DR de TRL 10 es la restauración probada: Cloud SQL desde backup y PITR, y la infraestructura desde Terraform. Un drill la ejecuta y mide RTO y RPO reales. Objetivos iniciales: pérdida o corrupción de datos, RTO ≤ 1 h y RPO ≤ 5 min; pérdida de la región `southamerica-west1`, RTO ≤ 8 h y RPO ≤ 24 h. Si el drill no alcanza un objetivo, se corrige la infraestructura o se enmienda el objetivo por ADR; no se declara cumplido por estimación.
- No se reconstruye el clúster de DR retirado por ADR-081.
- La «Condición de reversión» de ADR-058 sigue vigente: al firmar el primer contrato con SLA de uptime, Cloud SQL pasa a `REGIONAL` y Redis a `STANDARD_HA`, y se evalúa DR multi-región con réplica de Postgres.

**4. Alcance funcional.** Entran a TRL 10, y sus ADR quedan vigentes con el alcance que fija la spec:
- Extracción de `matching-engine`, `notification-service` y `document-service` como servicios propios ([ADR-048](./048-microservices-extraction-strategy.md)).
- Wake-word «Oye Booster» operativo ([ADR-036](./036-wake-word-voice-driver.md)).
- Eco-routing en tiempo real, Capa 1 de [ADR-012](./012-urban-observatory-digital-twins.md).
- Observatorio urbano piloto en Coquimbo, Capa 2 de ADR-012.
- Flujo de dinero bajo mandato de cobro ([ADR-080](./080-flujo-de-dinero-mandato-de-cobro-y-capital-de-trabajo.md)), con sus seis precondiciones de §6. Reemplaza al «factoring a escala plena» de la spec anterior (ADR-029 y ADR-032 están superados por ADR-080).

Quedan fuera: emisión de DTE ([ADR-069](./069-booster-deja-de-emitir-dte-remocion-sovos.md)), Capas 3 y 4 de ADR-012, apps nativas (ADR-008), internacionalización y SOC 2 Type II.

**5. Organización del trabajo.** `docs/frentes-vivos.md` pasa a ordenar el programa TRL 10 por fases, cada una con criterio de término. El trabajo de producto sale de la fase activa. Se mantienen el máximo de tres frentes en ejecución simultánea y de tres PRs propios abiertos.

## Consecuencias

**Positivas.**
- Hay un estado final verificable y un solo documento que lo define.
- Lo abandonado de hecho vuelve a tener decisión escrita.
- El informe a Corfo y los ADR dejan de contradecirse.

**Negativas y costos aceptados.**
- El alcance es largo. Varios criterios dependen de terceros con plazos propios: auditor GLEC, pentest externo, abogado, un municipio para el observatorio, Picovoice para el wake-word, y al menos un cliente con contrato.
- Los criterios de terceros tienen costo directo (auditorías, asesoría legal) que el PO presupuesta fuera de este ADR.
- La extracción de microservicios suma servicios desplegados y su costo base de Cloud Run.
- El load test necesita un entorno que no sea producción; la spec decide cuál.

**Lo que no cambia.** Las acciones irreversibles en prod siguen el gate de evidencia previa de ADR-076. Los deploys siguen siendo manuales con aprobación en el environment `production`.

## Verificación

```bash
# La definición de término existe y no tiene criterios sin marcar
test -f .specs/trl10/spec.md
grep -c '^- \[ \] \*\*T10-' .specs/trl10/spec.md   # TRL 10 se declara cuando es 0
```
