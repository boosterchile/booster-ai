# Follow-up: monitor de salud de la señal CAN (degradación silenciosa)

**Origen**: 2026-07-25. PLFL57 —el **único** vehículo de la flota que entregaba CAN— dejó de emitirlo el
**2026-07-23 ~11:16 (hora Santiago)** y **nadie se enteró**. Se descubrió dos días después porque el PO
preguntó si el dato seguía llegando, no porque el sistema avisara.

## El corte (evidencia de la DB de prod)

```
07-23 11:06:26   vel=0  83=t 85=t 87=t 81=t 89=t   ign=1     ← CAN normal
07-23 11:06:34   evt=239 (ignición OFF)             ign=0
07-23 11:07:36   evt=250 (trip end)                           ← último ping CON CAN
07-23 11:16:44   evt=239 (ignición ON)  83=f 85=f 87=f 81=f 89=f  ign=1   ← CAN nunca volvió
```

Los **cinco IDs LVCAN cayeron juntos** en un ciclo de ignición. No es la intermitencia normal (CAN gateado
por motor encendido): la ignición quedó en ON y el CAN no volvió.

| Hora (Santiago) | Pings en movimiento | Con CAN |
|---|---|---|
| 22-jul 09h / 13h | 244 / 230 | 244 / 230 (100 %) |
| 23-jul 10h | 147 | 147 (100 %) |
| 23-jul 11h | 240 | 30 ← el corte |
| **23-jul 12h** | **259** | **0** |
| **23-jul 13h** | **61** | **0** |

Más de una hora de viaje real, motor encendido, sin un solo dato de CAN. Desde el 23 ~13h el vehículo está
estacionado (heartbeat 1 ping/hora) → **no hay evidencia de recuperación**.

## Qué construir

Un chequeo de **salud de señal**, no de conectividad: hoy el device sigue mandando GPS perfecto, así que
toda la observabilidad existente lo ve "sano". Lo que falló es la *calidad del dato*, y eso no tiene
detector.

Criterio propuesto (afinar con el dato real):

- Para cada vehículo marcado como **CAN-capaz**, evaluar una ventana móvil de pings con `ignición=1` y
  `velocidad>0`. Si N pings consecutivos (p. ej. ≥50, ~15 min de viaje) no traen **ninguno** de los IDs
  LVCAN (81/83/84/85/87/89) → señal degradada.
- Distinguir explícitamente de los casos benignos: motor apagado (no emite CAN por diseño) y vehículo
  parado (heartbeat horario). El gate es `ign=1 AND velocidad>0`.
- **Falta el prerequisito**: no existe hoy una marca "este vehículo entrega CAN". Hace falta un flag de
  provisioning análogo a `tiene_sensor_temperatura` (#617, migr 0051) — mismo razonamiento: la ausencia de
  dato no distingue "no tiene la capacidad" de "la capacidad se rompió". Sin ese flag, VFZH-68/KZBB26/KZXB64
  (que nunca tuvieron CAN) dispararían falsos positivos permanentes.

Sobre el canal: `security-p1` tiene los topics en Terraform pero `notification-service` sigue siendo un
skeleton, así que **no conviene colgarse de ahí**. Esto no es una alerta P0 de seguridad física — es
degradación de calidad de dato; encaja mejor como métrica + alerta de Cloud Monitoring, o como panel de
salud de flota. Decidir al implementar.

## Por qué importa

1. **El carbono medido depende de este caudal.** El modo `exacto_canbus` del calculador GLEC necesita el
   combustible real (Δ83). Cortado el CAN, no hay insumo — y la deuda "cablear `exacto_canbus`" pasa de
   pendiente de software a bloqueada por hardware.
2. **El rollout CORFO.** Con PLFL57 caído, la flota tiene **0 vehículos entregando CAN**. Si los 10 camiones
   se instalan sin cubrir CAN/OEM en el runbook, se repite el caso en escala.
3. **Un viaje entero se perdió como dato.** El tramo del 23-jul quedó sin combustible real, irrecuperable.

⚠️ **No cubre esto**: #624 (distancia real híbrida) **no depende del CAN** — calcula con pings GPS + Routes
API. Ese PR sigue siendo válido y mergeable con el CAN caído.

## Acción de campo (fuera de software, no bloqueada por este followup)

Revisar el cableado del par CAN al bus del Scania en PLFL57 y re-correr AutoScan. Es el mismo modo de falla
que la bitácora 21–24 jul atribuye a VFZH-68 (causa física o de runtime de AutoScan, con `.cfg`
byte-idénticos en los 4 devices). Conviene hacerlo **antes** de que el camión vuelva a ruta, para no perder
otro viaje de datos.

## Estado

- **ABIERTO** — sin PR asociado. Prerequisito: definir el flag de provisioning CAN-capaz. La reparación
  física de PLFL57 es independiente y más urgente.
