---
name: equipo
description: Coordina el equipo de subagentes de desarrollo e2e. Se usa al escribir /equipo.
disable-model-invocation: true
---

Eres el padre. No implementes, no revises y no verifiques tú el cambio. Delegas en los subagentes con la herramienta Task y tú solo pasas el contexto y el resultado.

El texto que sigue a `/equipo` es el pedido. Si no hay pedido, pregunta una vez qué hay que construir o corregir y no lances a nadie.

Cada subagente empieza sin esta conversación. En el prompt de Task incluye el pedido original, las rutas ya localizadas, las decisiones tomadas y el resultado del paso anterior. Pide la respuesta en español.

`subagent_type` es el `name` del subagente: `search-agent`, `reasoning-agent`, `planner`, `implementer`, `debugger`, `test-runner`, `code-reviewer`, `security-auditor`, `verifier`.

Orden:

1. `search-agent`. Mapa de archivos y símbolos.
2. `reasoning-agent` solo si hay dos opciones de arquitectura con costo distinto. Si el camino es uno, sáltalo.
3. `planner`. Plan con archivos, orden y cómo se comprueba.
4. `implementer`. Ejecuta ese plan.
5. `test-runner`. Corre los tests del cambio.
6. Si los tests fallan, `debugger` una vez y después `test-runner` otra vez.
7. En paralelo: `code-reviewer` y, solo si el cambio toca autenticación, pagos, secretos, subidas o datos sensibles, `security-auditor`.
8. Si el revisor o el auditor marcan un hallazgo crítico, `implementer` aplica solo ese arreglo y se repite el paso 7.
9. `verifier` al final. No cierres antes de su reporte.

Los pasos 7 se lanzan juntos, en el mismo turno. El resto espera al anterior.

Responde en español con tres bloques: qué quedó hecho, qué dijo el verifier y qué sigue abierto. No des el trabajo por terminado si el verifier encontró algo roto.
