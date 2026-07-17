# Spec — feat/gateway-drain-shutdown

## Contexto

Cada deploy con devices conectados terminaba en hard-exit ("shutdown timeout, forcing
exit" ×7 en runtime): el shutdown esperaba `server.close()`, que jamás resuelve con
sesiones Teltonika long-lived → ganaba el timer de 30s → `exit(1)`, y `flush()` +
`pool.end()` nunca corrían. GKE da 60s de grace (90 en DR) − 5 de preStop ≈ 55s
utilizables; el código usaba 30. Recon completo en sesión 2026-07-17.

## Entradas / salidas

- **Entrada**: SIGTERM/SIGINT del rollout de GKE con N sesiones Teltonika activas.
- **Salida**: listeners cerrados → sockets drenados en QUIESCENCIA real (el packet en
  curso termina su publish+ACK y el device recibe su ACK) → FIN limpio por socket →
  `flush()` + `pool.end()` ejecutados → `exit(0)`. Hard-exit `exit(1)` solo como
  última red.

## Criterios de éxito

1. `Set` de sockets vivos registrado en `acceptConnection`; conexiones nuevas
   rechazadas durante el drain (carrera post-close de listeners).
2. Quiescencia: contador de ops en vuelo por conexión — `beginOp` antes de cada
   `processBuffer` (que corre sin serializar, un `void` por chunk), `endOp` en
   `finally`. Un socket cierra SOLO con contador 0.
3. Budgets: drain 40s + hard-exit 45s (< 55s efectivos del primary, < 85 del DR),
   reemplazando el timer de 30s. Comentario del manifest K8s alineado (solo comment,
   sin cambio funcional de campos).
4. Tests (TDD, rojos exhibidos): idle→FIN inmediato · packet en vuelo→espera ACK
   (ROJO sin wiring: "end called 1 times" con publish pendiente) · re-entrada de
   processBuffer (2 ops) · budget excedido sin colgar · path graceful alcanza flush
   y pool.end (hoy inalcanzables) · última red exit(1) · señal idempotente.
5. Suite gateway + tsc + biome verdes. PR sin merge (PO).

## Fuera de alcance

replicas>1 / eliminación de la reconexión de devices (con 1 réplica el rollout corta
la escucha igual; el drain convierte "matado a mitad de packet" en "FIN limpio").
Manifests aplicados (kubectl) — el deploy real lo hace el pipeline.
