# ADR-033 — Wave 3 TLS: Pre-cargar CA root al device FMC150 antes de activar TLS

**Fecha**: 2026-05-12
**Estado**: Accepted (validado en producción)
**Supersede parcialmente**: ADR-005 — sección "Status post-Wave 3" (procedimiento Wave 3 inicial)
**Refs**: `docs/handoff/2026-05-11-wave-3-incidente-rollback.md`, `docs/research/teltonika-fmc150/INSTRUCTIVO-WAVE-3.md`, `docs/runbooks/wave-2-3-deploy.md` §5.2

## Contexto

El plan original de Wave 3 (ADR-005) asumía que el firmware FMC150 tenía pre-instaladas las CA roots públicas comunes y que el handshake TLS contra el cert servidor Let's Encrypt funcionaría sin pasos adicionales en el device.

El 2026-05-08 se pusheó `FMC150_Booster_Wave3_1.cfg` al device productivo del cliente Van Oosterwyk (IMEI `863238075489155`). El device:
- Aplicó el cfg correctamente (`2020:1` TLS encryption primary, `2004:telemetry-tls.boosterchile.com`, `2005:5061`).
- Aparecía "En línea" en FOTA Web (canal RMS sano).
- Pero **no enviaba un solo record codec8 al gateway** durante 3 días.

Diagnóstico el 2026-05-11:
- Server-side todo OK (cert válido, LB UP, firewall abierto, handshake TLS verificado server-side desde dentro del cluster).
- Device-side: TLS handshake fallaba — el firmware FMC150 `04.01.00.Rev.08` no incluye `ISRG Root X1` (CA root de Let's Encrypt) en su trust store, por lo que no podía validar la cadena `server cert → R13 (intermediate) → ISRG Root X1`.

Resolución inicial (2026-05-11): rollback a Wave 2 plain via SMS-MT `setparam` (rollback documentado en ADR mismo).
Resolución definitiva (2026-05-12): Wave 3 v2 con paso pre-cert ANTES de activar TLS.

## Decisión

**Procedimiento Wave 3 v2** para FMC150 firmware `04.01.00.Rev.08` (y otros firmwares FMx con trust store limitado):

### Orden estricto del rollout

1. **Paso 0 (nuevo) — Cargar CA root al device**. Vía FOTA Web → "Cargar certificado TLS de usuario" con `isrgrootx1.pem` (Let's Encrypt root, válido hasta 2035). Esperar a que la task pase a `Completado` en FOTA.

2. **Paso 1 — Push cfg Wave 3** (`FMC150_Booster_Wave3.cfg` con `2020:1`, `2021:1`, hosts/ports TLS). Recién después del Paso 0.

### Validaciones de cierre (gate G3.4 extendido)

- TLS handshake primario completa: confirmar puerto local 5061 en `/proc/net/tcp6` del pod gateway, no solo "handshake IMEI completado" en logs.
- Persistencia: enviar SMS `cpureset`, confirmar reconexión post-boot en TLS 5061 (sin re-cargar cert).
- Failover DR: patch `targetPort` del Service primary a puerto cerrado, confirmar device conecta al cluster DR `us-central1` en `telemetry-dr.boosterchile.com:5061`.

### Rollback path estándar

Mantener **dos vías de rollback** documentadas y probadas:

- **Configurador local USB** (Teltonika Configurator desktop): Load `FMC150_Booster_Wave2.cfg` → Save to device. Requiere acceso físico.
- **SMS-MT** via operador SIM: `  setparam 2020:0;2004:telemetry.boosterchile.com;2005:5027` (2 espacios líderes obligatorios cuando cfg tiene `1250:0` SMS Login disabled con login/pass vacíos).

## Lecciones aprendidas que motivan esta decisión

1. **FOTA Web warning "FMx not compatible with TLS secure certificate transfer" es falso positivo** para firmware FMC150 `04.01.00.Rev.08`. La carga del cert SÍ funciona y persiste a través de `cpureset` completo (validado en producción 2026-05-12).

2. **"En línea" en FOTA Web ≠ telemetría operativa**. FOTA Web track el canal RMS (`fm.teltonika.lt`), independiente del flujo codec8 hacia el gateway. La verificación de telemetría productiva debe hacerse contra logs del gateway o métricas custom, no contra FOTA Web.

3. **Polling RMS del firmware FMC150 04.01.x no es inmediato**. Requiere ventana cellular sostenida (varios segundos de HTTPS estable) que no siempre ocurre en vehículos en movimiento por zonas rurales/cordillera chilena. Las tasks de FOTA pueden quedar Pendiente horas si el vehículo no entra en zona urbana estable. Mitigación: planificar rollouts cuando el vehículo está detenido (final de turno, depot/garage).

4. **Sintaxis SMS Teltonika con SMS Login disabled**: los 2 espacios líderes (`  command`) son obligatorios cuando `1250:0` con login/pass vacíos. Sin ellos el device descarta el SMS silenciosamente. Verificado vs documentación oficial Teltonika (ambigua) y vs comportamiento productivo.

5. **Sin SMS-MO activo (default en Truphone IoT)** el device no puede confirmar ejecución de comandos. La única señal indirecta es la observación del efecto en el gateway (TLS errors paran / records empiezan a llegar).

## Consecuencias

### Positivas

- Wave 3 productivo y validado en cliente Van Oosterwyk desde 2026-05-12.
- Procedimiento reproducible para devices nuevos: subir cert una vez, después push cfg Wave 3 normal.
- Rollback remoto sin acceso físico verificado y documentado.

### Negativas / riesgos

- **Renovación intermediate Let's Encrypt**: la cadena actual es `R13 → ISRG Root X1`. Si Let's Encrypt rota el intermediate (cada ~2 años), los devices siguen OK porque validan contra el root. Pero **si rotaran el root** (cambio a ISRG Root X2 ECDSA), habría que pushear el nuevo root a toda la flota antes de la rotación. ISRG Root X1 vence 2035-06-04 — tiempo amplio.

- **Single point of failure si el cert local en device se corrompe** (no documentado por Teltonika cómo o cuándo puede ocurrir). Mitigación: el rollback SMS plain Wave 2 sigue siendo opción válida.

- **Tiempo de rollout por device** se duplica (2 tasks FOTA en vez de 1), agregando latencia operacional. Aceptable para flota inicial pequeña, debería optimizarse con tooling cuando la flota crezca (>20 devices).

## Estado de las pre-conditions originales del ADR-005

| Pre-condition | Estado 2026-05-12 |
|---|---|
| G2.3 — Capacity load test PASS | Pendiente (saltado por incidente P1 — formalizar) |
| G3.4 — DR failover test PASS | **PASS** (validado 2026-05-12 14:34 UTC en device productivo) |
| Wave 2 estable >7 días | N/A (saltado por incidente P1) |

Las pre-conditions G2.3 y "Wave 2 estable 7d" se saltaron por necesidad operacional (incidente P1 requirió rollout urgente). Esto NO es procedimiento estándar — para próximos devices que se incorporen a Wave 3, las pre-conditions deben respetarse.

## Cambios derivados

- `docs/research/teltonika-fmc150/INSTRUCTIVO-WAVE-3.md`: nueva §0 con paso de cert preload + corrección de la afirmación errónea "no hace falta subir CA al device".
- `docs/runbooks/wave-2-3-deploy.md` §5.2: agregado Paso 0 obligatorio + rollback SMS alternativo.
- Memoria reference `reference_wave_3_v2_secuencia.md` (nueva).
- Memoria reference `reference_teltonika_sms_commands.md` (existente, complementa esta ADR).
