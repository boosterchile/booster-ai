# Runbook — Instalación de telemetría FMC150 con TLS (Paso 0 obligatorio)

**Para**: operador/instalador Booster con acceso a FOTA Web (Teltonika) y a este repo. **Nunca CI.**
**Qué hace**: deja un Teltonika FMC150 nuevo transmitiendo telemetría a producción vía TLS, con el criterio de éxito verificado en el **pipeline** (puntos persistidos en `telemetria_puntos`), no en la consola de Teltonika.
**Cuándo usarlo**: cada camión nuevo del rollout (entregable CORFO mes-9, ~10 camiones) · re-aprovisionar un device que quedó en loop de handshake fallido.
**Fuente normativa**: [ADR-040](../adr/040-wave-3-tls-ca-preload-fmc150.md) + [INSTRUCTIVO-WAVE-3](../research/teltonika-fmc150/INSTRUCTIVO-WAVE-3.md). Este runbook es standalone — no hace falta abrirlos para operar; ante contradicción, mandan ellos.

> **La regla que paga este runbook**: el firmware FMC150 `04.01.00.Rev.08` NO trae la CA raíz de Let's Encrypt (`ISRG Root X1`) en su trust store. Un device con cfg TLS pero sin la CA se ve **"En línea" en FOTA** y a la vez falla **todos** los handshakes contra el gateway (ECONNRESET cada ~2 min) — cero telemetría, sin error visible en ninguna consola de Teltonika. Costó 3 días de diagnóstico en mayo (ADR-040) y 4 días en julio. El orden §2 → §3 es **inviolable**.

---

## 1. Prerrequisitos y materiales

- Device FMC150 corriendo `FMC150_Booster_Wave2.cfg` con records estables **o** device nuevo a aprovisionar. **Backup obligatorio**: antes de tocar nada, *Save to file* de la cfg actual (es el rollback).
- Acceso FOTA Web con el device enrolado y visible.
- **IMEI: SIEMPRE copiado** desde FOTA Web o desde la etiqueta del device — **jamás transcrito a mano**. Los FMC150 de la flota comparten el prefijo `86069308…` y un typo ya costó una investigación entera. En queries SQL, resolver por patente con subselect (ver §4).
- **Mapeo IMEI→patente en `vehiculos` ANTES de instalar**: sin `vehiculos.teltonika_imei` seteado, el gateway acepta la conexión igual pero el processor **descarta cada punto** con un warn (y el log de éxito lo etiqueta "duplicado (skip)" — engañoso). El alta la hace un admin en el panel o el PO.
- La CA raíz, descargada y validada en el momento (no reutilizar archivos viejos):

```bash
curl -sS -o /tmp/isrgrootx1.pem https://letsencrypt.org/certs/isrgrootx1.pem
openssl x509 -in /tmp/isrgrootx1.pem -noout -subject -dates
# Esperado: Subject "ISRG Root X1", válido hasta 2035-06-04
```

- Camión **detenido en zona urbana** (depot/fin de turno). El polling RMS del firmware 04.01.x necesita ventana cellular sostenida: una task FOTA con el camión en movimiento por zona rural puede quedar `Pendiente` durante **horas**.

## 2. Paso 0 — Cargar la CA raíz al device (SIEMPRE primero)

1. FOTA Web → Dispositivo → **Crear tarea** → tipo **"Cargar certificado TLS de usuario"** → subir `isrgrootx1.pem`.
2. FOTA muestra un warning amarillo: *"FMx platform communication channel security is not compatible with TLS secure certificate transfer requirements. Use with caution."* — **FALSO POSITIVO**, validado en producción 2026-05-12: el cert se transfiere y **persiste a través de `cpureset` completo**. Continuar.
3. **Esperar a que la task pase a `Completado`** en FOTA. No pushear la cfg antes. Si tarda, ver §1 (camión en movimiento).

> ¿Por qué primero? La cadena del server es `cert → R13 (intermediate) → ISRG Root X1`; sin la raíz precargada el device no puede validarla y **aborta el handshake él mismo** (por eso el server ve ECONNRESET y no un error de certificado).

## 3. Paso 1 — Push de la cfg Wave 3 (TLS)

Recién con el Paso 0 en `Completado`, pushear `FMC150_Booster_Wave3.cfg` vía FOTA Web (o Configurator local). Delta clave respecto a Wave 2:

| Campo (GPRS → Server Settings) | Wave 2 | Wave 3 |
|---|---|---|
| Domain (primary) | `telemetry.boosterchile.com` | `telemetry-tls.boosterchile.com` |
| Port (primary) | `5027` | `5061` |
| TLS Encryption (primary) | None | **TLS** |
| Second Server (backup DR) | Disabled | `telemetry-dr.boosterchile.com:5061`, TLS |

Chequeo server-side del cert (no valida el device, valida que el endpoint sirva la cadena correcta):

```bash
openssl s_client -connect telemetry-tls.boosterchile.com:5061 -showcerts
# Esperado: issuer Let's Encrypt y CN match
```

## 4. Verificación REAL (criterio de éxito binario)

**"En línea" en FOTA NO significa transmitiendo.** FOTA trackea el canal RMS (`fm.teltonika.lt`), independiente del flujo de telemetría — un device puede estar verde en FOTA y llevar días sin mandar un record (así se manifestaron TODOS los incidentes de esta clase). Tampoco esperes ACK del device por SMS: sin SMS-MO activo (default en Truphone IoT) no hay confirmación de comandos.

Jerarquía de señales, de más débil a definitiva:

| Señal | Qué prueba | Qué NO prueba |
|---|---|---|
| "En línea" en FOTA | Canal RMS vivo | **Nada** sobre telemetría |
| `handshake IMEI completado` en logs gateway | TLS + identificación OK | Que los records persistan |
| **Filas en `telemetria_puntos`** | **Éxito end-to-end** | — |

**4a. Persistencia (la definitiva)** — read-only, resolviendo por patente:

```bash
scripts/db/agent-query.sh -c "SELECT count(*) AS puntos, max(timestamp_recibido_en) AS ultimo
  FROM telemetria_puntos
  WHERE imei = (SELECT teltonika_imei FROM vehiculos WHERE upper(patente) = '<PATENTE>')"
```

Éxito = `puntos > 0` con `ultimo` posterior a la instalación. Un device recién instalado típicamente **vuelca su buffer acumulado en una ráfaga** (miles de puntos en minutos) y luego transmite a cadencia normal (~1 record/min en movimiento, menos detenido).

**4b. Logs del gateway** (funciona desde cualquier host con gcloud autenticado):

```bash
gcloud logging read '
  resource.type="k8s_container"
  resource.labels.container_name="gateway"
  (jsonPayload.imei="<IMEI-COPIADO>" OR jsonPayload.message="tls handshake fallido")
' --project=booster-ai-494222 --freshness=2h --order=desc \
  --format='table(timestamp, jsonPayload.message, jsonPayload.imei, jsonPayload.errCode, jsonPayload.remoteAddress)'
```

- Éxito: `handshake IMEI completado` + `avl packet procesado` con tu IMEI.
- Los `tls handshake fallido` **no traen IMEI** (el device muere antes de identificarse) — correlacionar por timestamps/cadencia.
- Si Cloud Logging responde **429** (ADC sin quota project): agregar a la llamada REST el header `X-Goog-User-Project: booster-ai-494222` — verificado 2026-07-15. (El instructivo original verifica con `kubectl logs`; desde hosts fuera de la red allowlisted el control plane no responde — usar esta vía.)

## 5. Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| "En línea" en FOTA + **0 puntos** + `tls handshake fallido` con `errCode=ECONNRESET` cada ~2 min | **CA no cargada, o cargada DESPUÉS de la cfg TLS** | Re-ejecutar §2 (cargar la CA). Verificado jul-2026: cargar la CA a posteriori basta — el device valida en el siguiente reintento **sin** tocar la cfg. Si se necesita telemetría YA, rollback §7 mientras tanto |
| Device que **YA persistió** puntos y lleva horas callado | Apagado / sin ignición / sin cobertura — **NO es falla de CA** | Verificar estado físico del camión ANTES de tocar FOTA. **No recargar la CA a ciegas**: el silencio post-éxito es operacional, no criptográfico |
| `tls handshake fallido` con `errCode` distinto de ECONNRESET (p. ej. `ERR_SSL_NO_SUITABLE_SIGNATURE_ALGORITHM`) | Problema **server-side** (p. ej. cliente sin SNI contra el listener TLS) | Escalar al PO con el errCode crudo — no es un problema del device, no tocar FOTA |
| Conectó pero no aparece **ni** en `telemetria_puntos` **ni** en `dispositivos_pendientes` | IMEI sin mapear en `vehiculos` **y** ventana global del enrollment limiter agotada al conectar (el rastro se suprime — `imei-auth.ts:62-68`; 30 enrollments/60s por pod, compartida con el ruido de scanners) | Mapear IMEI→patente en `vehiculos` (§1) y esperar la reconexión; si debe aparecer en la bandeja, reintentar en otra ventana |
| Task FOTA `Pendiente` por horas | Camión en movimiento / cobertura intermitente | Esperar ventana urbana detenido; no relanzar la task en paralelo |
| SMS de rollback sin efecto | Faltan los **2 espacios líderes** (cfg con `1250:0`, SMS Login disabled) | Reenviar con los espacios exactos (§7); el firmware descarta en silencio los SMS mal formados |

## 6. Control de cambios FOTA (obligatorio para el rollout)

La saga de julio incluyó ventanas con **más de un operador tocando config del mismo device sin registro** — irreproducible de auditar. Para el rollout de ~10 camiones:

1. **Autoriza el PO** (`dev@boosterchile.com`): ninguna task FOTA (cert o cfg) sin su OK explícito previo.
2. **Un operador por device por ventana**: nunca dos personas con tasks activas sobre el mismo IMEI.
3. **Registro por cambio** en la bitácora del rollout (`docs/corfo/` del hito vigente): fecha/hora (Santiago), IMEI (copiado), tipo de task, quién, resultado (`Completado`/`Pendiente`/error) y verificación §4 con su timestamp. Sin la fila de registro, el cambio no existió.

## 7. Rollback (device sin telemetría y se necesita YA)

- **Con acceso físico**: Teltonika Configurator → *Load from file* `FMC150_Booster_Wave2.cfg` → *Save to device*. Vuelve a plain `telemetry.boosterchile.com:5027` (el server lo mantiene activo).
- **Remoto vía SMS-MT** (SIM con "SMS MT Service: Active"; probado 2026-05-11) — los 2 espacios líderes son parte del comando:

```
  setparam 2020:0;2004:telemetry.boosterchile.com;2005:5027
```

Efectivo ~30s tras `Delivered` + reconexión cellular. Después del rollback, el camino de vuelta a TLS es este runbook desde §2.

## 8. Ejecuciones de referencia

- **VFZH-68** (IMEI `863238075489155`) — **run de referencia validado en producción, 2026-05-12** (ADR-040): Paso 0 + cfg Wave 3 v2, gates de cierre pasados (handshake TLS en 5061, persistencia tras `cpureset` sin recargar cert, failover DR a `us-central1`). Es la ejecución contra la que se escribió el procedimiento.
- **KZXB64 / PLFL57 / KZBB26** (jul-2026) — confirmaron el **síntoma** (ECONNRESET por CA ausente) y la **recuperación** al cargar la CA con la cfg TLS ya puesta; su orden de carga completo **no está confirmado**, así que quedan como candidatos pendientes de un run limpio end-to-end de este runbook — el primer camión del rollout mes-9 debería documentarse como segundo run de referencia.

---
*Creado 2026-07-16 a partir de ADR-040 + INSTRUCTIVO-WAVE-3 §0–§4 y la bitácora de incidentes jul-2026. Corregir tras cada corrida real, como el resto de los runbooks de `docs/qa/`.*
