# Handoff — Incidente Wave 3 TLS: device sin telemetría 32+h (2026-05-11)

**Severidad**: P1 — primer cliente productivo (Van Oosterwyk) sin telemetría.
**Owner**: Felipe Vicencio (PO).
**Detección**: 2026-05-11 ~10:00 CLT vía verificación manual del PO.
**Causa raíz**: cfg `FMC150_Booster_Wave3_1.cfg` (push 2026-05-08 23:11) activó TLS en el device sin que el firmware FMC150 `04.01.00.Rev.08` complete handshake contra cert Let's Encrypt del LB primary.
**Resolución**: 2026-05-11 16:00 UTC — vía `setparam` por SMS-MT (Truphone Connect) con sintaxis `  setparam 2020:0;2004:telemetry.boosterchile.com;2005:5027` (2 espacios prefijo). Device reconectó plain `:5027`, telemetría restablecida.
**Wave 3 v2 — éxito final**: 2026-05-12 — Cargado `isrgrootx1.pem` al device via FOTA, pusheado cfg Wave 3, device reconectó TLS 5061 exitosamente. Las 3 validaciones (puerto TLS 5061, persistencia post-cpureset, failover DR) pasaron. Wave 3 productivo y validado. Ver **ADR-033** para procedimiento definitivo.

## TL;DR

- Server-side **100% operativo**: services TLS + plain UP en primary y DR, certs `Ready`, pods sin restarts, firewall abierto, handshake TLS verificado server-side desde dentro del cluster (TLSv1.2 / cert válido).
- Device-side **roto**: el Teltonika no abre TCP a ninguno de los 3 endpoints (`:5027`, primary `:5061`, DR `:5061`). 0 records codec8 en buffer del pod (~32h).
- FOTA Web marca el device "En línea" pero esa señal es el canal RMS (`fm.teltonika.lt`), independiente del flujo codec8 → nuestro gateway.

## Evidencia

```
PRIMARY pods:        2/2 Running 20-32h sin restart
Service plain :5027: LB 34.176.238.106  UP  6d14h
Service TLS   :5061: LB 34.176.1.94     UP  2d21h
Certificate primary: Ready=True (Let's Encrypt prod, 2d20h)
DR Service TLS:      LB 136.116.208.86  UP  2d20h
DR Certificate:      Ready=True
Firewall :5027 + :5061 + :5061 DR: INGRESS 0.0.0.0/0 ALLOW

TLS probe desde Pod (sin firewall externo):
  CONNECTION ESTABLISHED / TLSv1.2 / Verification: OK / CN=telemetry-tls.boosterchile.com

externalTrafficPolicy=Local en ambos services → sourceIp NO enmascarado por SNAT.

Logs gateway primary últimas 24h:
  11,521 conexiones totales — todas con imei=null, sourceIp 10.20.1.1 (healthcheck GCP LB)
  0 conexiones con imei populado
  0 records recibidos
  16 "tls handshake error" / hora — patrón inconsistente con device retry (sin sourceIp porque socket close pre-context); probable scanner internet

Conexiones con IMEI 863238075489155: 0 (ninguna en todo el buffer del pod)
```

## Diff Wave 2 → Wave 3_1 (cfg parseado)

Sólo 7 parámetros cambian entre el cfg que funcionaba (Wave 2) y el actual (Wave 3_1):

| Param | Wave 2 (works) | Wave 3_1 (current, broken) |
|---|---|---|
| 2004 (domain primary) | `telemetry.boosterchile.com` | `telemetry-tls.boosterchile.com` |
| 2005 (port primary) | `5027` | `5061` |
| 2007 (domain backup) | (vacío) | `telemetry-dr.boosterchile.com` |
| 2008 (port backup) | `0` | `5061` |
| 2010 (backup enable) | `0` | `1` |
| **2020 (TLS primary)** | **`0`** | **`1`** ← culpable |
| **2021 (TLS backup)** | **`0`** | **`1`** ← culpable |

## Acción que resolvió (SMS-MT via Truphone Connect)

**FOTA Web NO funcionó como vía**:
- Task "Configuración de la carga" Wave 2 quedó **Pendiente** 1.5h sin que el device la procesara (polling RMS interrumpido por cobertura cellular intermitente — vehículo en movimiento).
- FOTA Web Cloud **no tiene opción de "Send command" ni "Reboot"** en la UI actual (verificado parseando dropdown de tipos de tarea: solo firmware/cfg/autorizaciones/cert TLS/logs/OEM).

**Lo que sí funcionó**:

Truphone Connect → SIM Cards → ICCID `8944474400008090359` → Send SMS:
```
  setparam 2020:0;2004:telemetry.boosterchile.com;2005:5027
```

**Crítico**: el SMS DEBE empezar con **2 espacios** porque el cfg tiene `1250:0` (SMS Login disabled) con `1251`/`1252` vacíos — el firmware FMC150 04.01.x usa la sintaxis `<login> <password> <command>` y exige los separadores espacio aunque login/password sean vacíos. Sin los 2 espacios, el device descarta el SMS silenciosamente (3 intentos previos sin espacios = Delivered pero sin efecto).

Tiempo de resolución una vez enviado SMS con sintaxis correcta: ~46 min (incluye ventana de cobertura intermitente del vehículo).

Datos clave Truphone:
- MSISDN del device: `4915299520975` (Truphone Global, número alemán roaming)
- SMS MO Service: **Suspended** → device NO puede confirmar ejecución via SMS-MO
- SMS MT Service: Active → vía válida para enviar comandos
- Portal: https://iot.truphone.com/sims/{ICCID}/ y https://iot.truphone.com/sms/

## Acciones previas que NO funcionaron

1. **FOTA "Configuración de la carga"** con cfg Wave 2 (task 171659313 Pendiente) — device no completaba polling RMS por movimiento + zonas marginales.
2. **SMS `web_connect`** ×3 (sin espacios) — Delivered pero sin efecto (sintaxis rechazada).
3. **SMS `cpureset`** (sin espacios) — Delivered, probable que sí ejecutó (10 min silencio TLS errors 14:53-15:03 consistente con reset), pero al volver retomó cfg Wave 3.
4. **SMS `setparam ...`** (sin espacios) — Delivered pero sin efecto.

## Monitoreo post-rollback

```bash
kubectl --context=gke_booster-ai-494222_southamerica-west1_booster-ai-telemetry \
  logs -n telemetry deployment/telemetry-tcp-gateway --follow \
  | grep --line-buffered 863238075489155
```

Esperado en <5 min: log con `imei:"863238075489155", recordsReceived:N, recordsPublished:N`.

Si no aparece en 10 min: device puede tener problema cellular (Truphone APN, signal). Verificar en FOTA Web → Detalles del dispositivo → última actividad RMS.

## Estado post-resolución (verificar)

Telemetría restablecida pero quedan **acciones pendientes**:

1. **¿`setparam` persistió en flash o solo RAM?** Si solo RAM, al próximo `cpureset` o pérdida de poder el device vuelve a Wave 3 → reincidirá el outage. Verificar:
   - Próximo polling RMS exitoso del device → "Configuración" en FOTA Web debería seguir mostrando `Wave3_1.cfg` aunque el device está corriendo Wave 2 effective.
   - Para hacerlo permanente: push de cfg Wave 2 vía FOTA cuando el device tenga ventana de cobertura estable (task 171659313 sigue Pendiente — debería completar sola).
2. **Cancelar o dejar la task Wave 2 pendiente en FOTA**: si se aplica, sobrescribe el setparam con un cfg completo Wave 2 (deseable para persistencia).
3. **Cobertura intermitente del vehículo**: factor agravante. Documentar como riesgo recurrente para flota productiva.

## Intento Wave 3 v2 — 2026-05-11 tarde (no concluido)

Tras estabilizar Wave 2 en la mañana, se intentó re-introducir Wave 3 con CA root preinstalada:

**Acciones ejecutadas:**
1. Descargado `isrgrootx1.pem` de https://letsencrypt.org/certs/isrgrootx1.pem.
2. Verificado cadena del cert servidor: `CN=telemetry-tls.boosterchile.com → CN=R13 → ISRG Root X1` ✓.
3. FOTA Web → tarea "Cargar certificado TLS de usuario" con `isrgrootx1.pem` (task 171686771) → **Pendiente**.
4. FOTA Web → tarea "Configuración de la carga" con `FMC150_Booster_Wave3_1.cfg` (task 171686944) → **Pendiente**.
5. SMS-MT `  cpureset` enviado para forzar polling RMS — device reseteo confirmado (sesión TCP nueva), pero **polling RMS no completó post-boot**.
6. SMS-MT `  dotaskrequest` enviado para pedir tasks RMS sin reset — Delivery pendiente (vehículo en ruta con señal débil).

**Resultado**: las 2 tasks Wave 3 quedaron Pendientes. **Wave 3 NO se aplicó** en esta sesión.

**Blockers operacionales identificados:**
- **FOTA WEB warning**: "FMx platform communication channel security is **not compatible** with TLS secure certificate transfer requirements. Use with caution. FT platform devices are fully compatible". El FMC150 es FMx — la carga del cert puede no funcionar aunque la task aplique.
- **Polling RMS del firmware FMC150 04.01.00.Rev.08 no completa post-cpureset** durante operación normal (vehículo en ruta con cobertura intermitente). Solo se completó la mañana (task Wave 2 rollback 171659313) cuando hubo una ventana cellular suficientemente estable.
- **`dotaskrequest` SMS**: no se pudo validar efectividad en esta sesión (vehículo entró en zona sin señal antes del delivery).

**Camino corregido para próximo intento** (cuando vehículo esté detenido en cobertura estable, ej. final de turno):
1. Las 2 tasks Wave 3 ya están en cola, no requieren re-armado.
2. Cuando "Visto en" en FOTA Web se actualice a una hora reciente → polling RMS completó → tasks deberían aplicar automáticamente.
3. Si task de cert falla por warning FMx → única vía garantizada es **Configurador USB en taller** (técnico, cable, software Teltonika Configurator desktop).
4. Si task de cert OK pero handshake TLS falla → SMS rollback armado: `  setparam 2020:0;2004:telemetry.boosterchile.com;2005:5027` (probado y confiable, 30s para restaurar Wave 2).

## Plan para re-introducir Wave 3 (defer, posterior a estabilización)

El TLS dual-endpoint es válido como objetivo, pero requiere paso previo no contemplado en el runbook actual:

1. **Cargar CA root de Let's Encrypt en el device** vía FOTA Web (file ID `1551` o el correspondiente al FMC150 cfg gen 13.0.0.0). Sin esto, el firmware no valida el cert servidor.
2. Verificar parámetro de TLS Verify (probablemente `2018` o `2019`) — confirmar contra manual oficial Teltonika.
3. Smoke test contra **un device de lab** con la combinación CA root + TLS Verify + cert servidor antes de tocar producción.
4. Recién después, push Wave 3 a flota productiva.

Pre-conditions del runbook original (`docs/runbooks/wave-2-3-deploy.md` §5.2) deben actualizarse con el paso del CA root.

## Aprendizajes operacionales (referencia futura)

1. **FOTA Web Cloud NO tiene Send command / Reboot remoto** en la UI — solo firmware uploads, cfg push/pull, autorizaciones, cert TLS, logs, archivos OEM. Para comandos al device (cpureset, setparam, getstatus, web_connect) **hay que ir por SMS-MT via SIM operator** (Truphone Connect en este caso).

2. **Sintaxis SMS Teltonika FMC150 04.01.x**: el comando debe ir precedido del par `<login> <password>`. Si ambos están vacíos en cfg (`1250:0`, `1251`/`1252` vacíos), igualmente requiere **2 espacios prefijo** (`  command`). Sin ellos el device descarta el SMS silenciosamente (Delivered pero no ejecutado).

3. **"En línea" en FOTA Web ≠ reportando codec8**: FOTA Web track RMS (`fm.teltonika.lt`), independiente del flujo codec8. Un device puede estar "En línea" en FOTA y simultáneamente sin enviar telemetría.

4. **"Visto en" de FOTA Web** = último ping RMS exitoso, no actividad cellular. Puede mostrar valores muy desactualizados aunque la SIM tenga data session activa (verificar en portal del operador SIM).

5. **Truphone Connect — datos útiles**:
   - URL detalle SIM: `https://iot.truphone.com/sims/{ICCID}/`
   - URL send SMS: `https://iot.truphone.com/sms/`
   - URL SMS History: `https://iot.truphone.com/sms/history/`
   - Para FMC150 con ICCID `8944474400008090359`: MSISDN `4915299520975`, SMS MO **Suspended** (device no responde por SMS), SMS MT **Active**.

6. **Sin SMS MO el device no confirma ejecución de comandos**: la única señal indirecta de éxito es observar el efecto en el gateway (TLS errors paran / records empiezan a llegar).

7. **Cobertura cellular intermitente (vehículos en movimiento por zonas rurales/cordillera chilena)** es factor agravante recurrente. Tanto polling RMS como SMS quedan en cola del SMSC/operador hasta ventana de señal estable.

8. **Comando `setparam` Teltonika**:
   - Single: `setparam <id>:<val>`
   - Multi: `setparam <id1>:<val1>;<id2>:<val2>;...` (separador `;`)
   - Params clave para server: `2004` (domain primary), `2005` (port primary), `2007/2008` (backup), `2010` (backup enable), `2020/2021` (TLS encryption primary/backup).

## Follow-ups técnicos

- **Mejorar log del gateway**: el evento `tlsClientError` no captura `socket.remoteAddress` porque el socket está cerrado al momento de log. Workaround: registrar `connection` event del `tls.Server` y mantener `remoteAddress` en una `WeakMap` para correlacionar.
- **Alerta Cloud Monitoring**: definir alerta P1 en métrica custom `device_records_per_minute` filtrado por IMEI productivo. Threshold: 0 records en 15 min → page.
- **Health check vía FOTA RMS NO ES SUFICIENTE**: documentar en CLAUDE.md / runbook que "En línea" en FOTA es señal de RMS (control plane Teltonika), no de codec8 hacia nuestro gateway. Son canales independientes.
- **ADR follow-up de ADR-005**: superseder sección "Status post-Wave 3" cuando el rollout corregido se ejecute.

## Referencias

- Handoff previo: [2026-05-10-wave-3-tls-ready.md](2026-05-10-wave-3-tls-ready.md) (decía "código mergeado, bloqueado operacionalmente" — pero el cfg Wave 3 fue pusheado el 2026-05-08 prematuramente, antes de las pre-conditions del runbook).
- Runbook: `docs/runbooks/wave-2-3-deploy.md` §5.2.
- INSTRUCTIVO: `docs/research/teltonika-fmc150/INSTRUCTIVO-WAVE-3.md`.
- ADR-005: Stack telemetría IoT.
