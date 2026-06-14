
# Devils-advocate review — feat-cloud-run-ingress-internal-lb — 2026-06-14T03:05:00Z

## Premise
- Assumed: que api y web "solo se sirven via GCLB" y que TODOS los callers internos (9 schedulers + bot->api) "entran como trafico interno del proyecto" al ingress internal-and-cloud-load-balancing por usar la URL run.app (spec 3 SC-3, ADR 2 fila api, compute.tf:315-316).
- Most painful if false: la parte bot->api ES falsa. El bot llama local.cloud_run_api_url (run.app, IP publica del Google Frontend) y NO tiene override de vpc_egress -> usa el default del modulo PRIVATE_RANGES_ONLY (modules/cloud-run-service/variables.tf:90; confirmado cero overrides de vpc_egress en todo infra/*.tf). Con PRIVATE_RANGES_ONLY el trafico a una IP PUBLICA (run.app lo es) NO se enruta por el VPC connector: sale directo a internet. Al llegar al api con ingress internal-LB NO cuenta como interno -> rechazado. La premisa que sostiene SC-3 para el bot esta rota.

## Scope and second-order effects
- Hyrum: bot->api por run.app es un contrato observable en prod (compute.tf:568 API_URL = cloud_run_api_url, ~19 req/dia ADR-034). Endurecer el api lo rompe sin que el bot este en scope del cambio. El comentario compute.tf:559-566 documenta DELIBERADAMENTE que el bot usa run.app "NO el LB publico" por falsos positivos del WAF: re-apuntarlo al GCLB (mitigacion que la spec ofrece en 9) reintroduce el 403 del scannerdetection que ese comentario dice evitar. La spec propone como rollback algo que el repo documenta como problematico.
- Segundo orden no consultado: si el bot falla contra el api, los WhatsApp fallback templates (cron chat-whatsapp-fallback cada 1 min) y el flujo inbound degradan en silencio salvo alerta del bot (no hay uptime check del bot en monitoring.tf/telemetry-monitoring.tf).

## Alternatives discarded
- Considered en spec 8: A (INTERNAL_ONLY, bien rechazada), B (re-rutear por GCLB), C (todo de una).
- Objecion a la justificacion de B: la spec rechaza B diciendo que /admin/jobs/* "quedaria bajo evaluacion OWASP". FALSO. networking.tf:198-224 tiene un ALLOW priority 390 = request.headers[host] == api.boosterchile.com que es "Bypass TOTAL para hostname api (todos los metodos)" (comentario linea 208). Si los schedulers/bot fueran a api.boosterchile.com, hit priority 390 -> skip OWASP. El motivo declarado para descartar B es contradicho por la regla que la spec misma cita. B es mas viable de lo que el ADR admite.
- Not considered (should have been): setear vpc_egress = ALL_TRAFFIC en el bot + Private Google Access, patron GCP documentado para que un Cloud Run alcance otro con ingress interno por run.app. La spec no lo menciona; lo "descubre" como mitigacion reactiva en 9 ("se le da VPC egress") sin reconocer que es PRECONDICION, no rollback.

## Failure modes
- F1 - bot->api rechazado tras apply del api. Deteccion: logs del bot 403/connection-refused o degradacion WhatsApp. Recuperacion: rollback ingress api->ALL ~30s O cambiar bot a ALL_TRAFFIC egress (nuevo apply). Costo: ventana de mensajeria WhatsApp degradada hasta detectar. Probabilidad ALTA, no Media como dice 9: la config (PRIVATE_RANGES_ONLY) predice rechazo, no es incertidumbre.
- F2 - el "rollback de 1 linea" no es atomico si web Y api se aplican juntos (plan 11 etapa 1 aplica ambos; etapa 2 dice "si se separo"). Sin -target, web y api cambian a la vez; revertir solo api deja la duda de si web rompio algo. Deteccion: smoke. Costo: confusion en ventana.
- F3 - recreacion del servicio en vez de update in-place (L, no verificado por plan real). Si recrea, downtime del api. Deteccion: SOLO el plan lo muestra, y el plan NO se corrio (verify.md:22). El gate depende de que el PO lea el plan correctamente bajo presion de ventana.

## Reversibility
- Cost to undo en 30 dias: bajo en mecanica (revertir ingress a ALL, 1 linea, sin perdida de datos, cambio de red puro). Correcto.
- PERO la reversibilidad asume que el problema se DETECTA. Si bot->api falla intermitente (cold starts, retries de Twilio enmascarando) puede no detectarse en la ventana y degradar despues. No hay alerta dedicada del bot. La reversibilidad facil no compensa la deteccion debil.

## Drift signals
- El hook bloqueo dos veces mi propio grep (falso positivo: la lista de vocabulario iba como patron de busqueda, no como contenido). En los ARTEFACTOS: "follow-up" x4 (whatsapp-bot inbound, private-services) justificados en ADR como posture incremental, aceptable. No hay marcadores de deferral sin ticket en los artefactos nuevos. El unico placeholder relevante (canary-verify exit 0) es preexistente, ajeno a este PR.
- Unjustified: ninguno nuevo introducido por este PR.

## Evidence quality
- Claim "Cloud Scheduler alcanza ingress internal-LB en mismo proyecto" -> Evidencia: doc GCP (Scheduler mismo proyecto via run.app = interno, sin VPC connector). Verdict: SUFICIENTE. OQ1 se sostiene PARA LOS 9 CRONS.
- Claim "bot->api entra como trafico interno" -> Evidencia: ninguna; contradice config real (PRIVATE_RANGES_ONLY + IP publica run.app). Verdict: AUSENTE/FALSO. Objecion fuerte.
- Claim "ingress es update in-place, no ForceNew (SC-7)" -> Evidencia: razonamiento de provider (verify.md:24), plan NO corrido (ADC invalid_rapt). Ingress SI es PATCH mutable (correcto), pero SC-7 exige el OUTPUT del plan y no se tiene. Verdict: DEBIL (conclusion probablemente correcta, evidencia no es la que el criterio pide).
- Claim "GCLB invoca con internal-and-cloud-LB" -> Evidencia: networking.tf:696 (el comentario que ESTE PR corrige por estar mal antes) + doc GCP independiente. Verdict: SUFICIENTE pero ironico (confiar en el mismo archivo cuyo error motivo el ciclo); pasa por la doc GCP.
- Claim "sms-fallback no tiene NEG" -> Evidencia: grep networking.tf solo muestra NEG/backend para api/web/whatsapp_bot (104-133). Verdict: SUFICIENTE. SC-4 correcto.
- Claim "uptime checks no se rompen" -> Evidencia: monitoring.tf:68/94 y signup-probe.tf:51 pegan a api.${domain}/www.${domain} (GCLB), NO a run.app. Verdict: SUFICIENTE. Sin objecion para api/web en este eje.

## Verdict — APROBADO CON OBSERVACIONES (una objecion fuerte que debe resolverse antes del apply del api)

Strong objections (must address):
- O1 [BLOQUEANTE para el apply del api]: bot->api SE ROMPERA. El bot usa run.app (IP publica) con vpc_egress=PRIVATE_RANGES_ONLY (default modulo, sin override - variables.tf:90, cero overrides en infra). Ese trafico no entra por VPC -> el api con ingress internal-LB lo rechaza. La spec lo cataloga "M/M con rollback" pero la config predice fallo ALTO. Antes de endurecer el api: setear vpc_egress=ALL_TRAFFIC en service_whatsapp_bot (compute.tf) + Private Google Access, O re-apuntar el bot a public_api_url (audience ya aceptado, API_AUDIENCE compute.tf:95) ACEPTANDO el 403 del WAF que compute.tf:559-566 documenta. Es precondicion, no validacion en ventana. SC-3 esta sobre-vendido para el bot.

Residual risks (accept and document):
- R1: 8.B descarta re-rutear por GCLB con un motivo falso (OWASP sobre /admin) - existe el ALLOW total priority 390 host==api. Corregir el razonamiento del ADR aunque la decision final siga siendo no re-rutear.
- R2: SC-7 (no-recreacion) afirmado sin el plan que el propio criterio exige. El gate del PO debe ejecutar el plan ANTES del apply, no asumirlo.
- R3: no hay alerta/uptime del bot -> un fallo bot->api post-apply puede no detectarse en la ventana. Sumar criterio de exito medible del bot al 11.
- R4: rollback "1 linea" deja de ser atomico si web+api se aplican juntos; forzar -target staged real.

Out of scope:
- whatsapp-bot inbound y servicios privados (follow-ups documentados, correctamente diferidos).
- Twilio->sms-fallback (correcto dejarlo en ALL; SC-4 solido).

---

## Resolución del fix-round (2026-06-14, post-review)

| Hallazgo | Acción |
|---|---|
| **O1 BLOQUEANTE (bot→api se rompe)** | RESUELTO en el PR: bot re-apuntado a `public_api_url` (GCLB) — compute.tf:570-571. El api ve tráfico originado en el LB (aceptado por internal-and-cloud-LB) independiente del egress del bot. NO se usa `vpc_egress=ALL_TRAFFIC` (cambiaría todo el egress del bot); el path GCLB es más limpio. El 403 del WAF NO reaparece: priority-390 bypassa el WAF para host==api.boosterchile.com. Deja de ser "validación en ventana" → es fix en código. |
| **R1 (§8.B motivo falso)** | RESUELTO: spec §8.B + ADR §4 reescritos — los schedulers se quedan en run.app porque ya son internos; el WAF no era el motivo (priority-390 lo bypassa). |
| **R2 (SC-7 sin plan)** | Aceptado y marcado: verify.md declara el plan como gate pre-apply del PO (no asumido). Fundamento: ingress es PATCH mutable, no ForceNew. |
| **R3 (sin alerta del bot)** | RESUELTO en §11: criterio de éxito medible agregado — tras el apply del api, trigger explícito del cron `chat-whatsapp-fallback` (`gcloud scheduler jobs run`) + verificar 200 en logs del bot, NO esperar a que un mensaje real degrade. |
| **R4 (rollback no atómico)** | RESUELTO en §11: staging con `-target` OBLIGATORIO (web primero, validar; api después, validar) — no "si se separó". |
| **sec MEDIA (privados / bot framing / stubs) + BAJA (sms DoS)** | RESUELTOS: ADR-062 reescrito (filas privados/bot/sms con motivación real); 2 stubs de follow-up creados + padre actualizado. |
| **sec BAJA (guard CI sobre service_api.ingress)** | Documentado como recomendación; no se construye en este PR (mantener atómico) — candidato a repo-check en un ciclo de test-infra. |

`terraform validate` OK tras el fix-round. Cambio listo para PR.
