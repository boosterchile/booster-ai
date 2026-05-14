# Instructivo Wave 3 — FMC150 (delta sobre Wave 2)

> **Pre-requisito**: el device debe estar corriendo `FMC150_Booster_Wave2.cfg` con records llegando estables. Si Wave 2 está OK, este delta agrega TLS dual-endpoint (primary 5061 + DR backup) sin tocar nada de la lógica de telemetría.

> **Backup obligatorio**: antes de tocar nada, **Save to file** la cfg actual del device como `FMC150_Booster_Wave2.cfg` (si no la tenés ya). Eso queda como rollback.

> **⚠️ Lección 2026-05-11**: el firmware FMC150 `04.01.00.Rev.08` **no tiene `ISRG Root X1` (CA root Let's Encrypt) preinstalado** en su trust store. Sin el paso §0, el handshake TLS falla silenciosamente y el device queda sin enviar telemetría hasta rollback manual. **Hacer §0 ANTES de tocar §1**.

---

## §0 — Cargar CA root `ISRG Root X1` al device (obligatorio para FMx)

Esta task **debe completarse antes** de pushear el cfg Wave 3. Si se hace en orden inverso, el device queda con cfg apuntando a TLS pero sin CA → handshake falla.

1. **Obtener el cert** ISRG Root X1 PEM:
   ```bash
   curl -sS -o /tmp/isrgrootx1.pem https://letsencrypt.org/certs/isrgrootx1.pem
   openssl x509 -in /tmp/isrgrootx1.pem -noout -subject -dates
   # Subject: ISRG Root X1, válido hasta 2035-06-04
   ```

2. **FOTA Web** → Dispositivo → **Crear tarea** → tipo **"Cargar certificado TLS de usuario"** → subir `isrgrootx1.pem`.

   > FOTA muestra un warning amarillo: *"FMx platform communication channel security is not compatible with TLS secure certificate transfer requirements. Use with caution."* **Es falso positivo** — en producción 2026-05-11 con firmware `04.01.00.Rev.08` el cert SÍ se transfirió correctamente y persistió a través de `cpureset` completo (validación 2026-05-12).

3. **Esperar a que la task pase a Completado** en FOTA. Solo después, ir a §1 con el cfg Wave 3.

> Si el vehículo está en operación con cellular intermitente, la task puede tardar horas en Completarse (requiere polling RMS exitoso). Una ventana de cellular estable de varios minutos (vehículo detenido en zona urbana) basta.

---

## §1 — `GPRS → Server Settings` (primary → TLS)

| Campo | Wave 2 actual | Wave 3 |
|---|---|---|
| Domain | `telemetry.boosterchile.com` | `telemetry-tls.boosterchile.com` |
| Port | `5027` | `5061` |
| Protocol | TCP | TCP (TLS va por encima) |
| **TLS Encryption** | None | **TLS** |

> El cert servidor es Let's Encrypt (chain: `server → R13 → ISRG Root X1`). Con §0 completado, el FMC150 valida el chain contra el ISRG Root X1 ya cargado al device.

---

## §2 — `GPRS → Second Server Settings` (backup DR)

| Campo | Wave 2 actual | Wave 3 |
|---|---|---|
| **Server Mode** | Disabled | **Backup** |
| Domain | (vacío) | `telemetry-dr.boosterchile.com` |
| Port | `0` | `5061` |
| Protocol | TCP | TCP |
| **TLS Encryption** | None | **TLS** |

> El device hace switchover automático al backup tras 5 timeouts consecutivos al primary (criterio Teltonika default). Cuando primary vuelve, retorna automáticamente.

---

## §3 — Verificación post-push

Después de pushear `FMC150_Booster_Wave3.cfg` vía FOTA WEB o Configurator local, en el server-side:

| Check | Cómo verifico (yo) |
|---|---|
| Handshake TLS al primary | logs gateway: `kubectl logs -n telemetry deployment/telemetry-tcp-gateway` filtrando `imei=863238075489155` y palabra `TLS` |
| Records llegando por puerto 5061 | metrics Cloud Monitoring `tcp_resets` debe seguir en 0, y `device_records_per_minute` con `port=5061` |
| Cert válido en el handshake | `openssl s_client -connect telemetry-tls.boosterchile.com:5061 -showcerts` debe mostrar issuer Let's Encrypt y CN match |

Si el primary se cae:

| Check failover | Cómo |
|---|---|
| Device cae a backup DR | logs del cluster DR (us-central1) deben mostrar handshake del IMEI |
| `telemetry_dr_lb_ip` (136.116.208.86) recibiendo conexiones | `kubectl --context=booster-ai-telemetry-dr logs -n telemetry deployment/telemetry-tcp-gateway` |
| Records persisten en BD | el DR publica al mismo Pub/Sub global → processor primary los consume → `telemetria_puntos` actualiza |

---

## §4 — Rollback

Si el handshake TLS falla (cert expirado, CA no confiable en device, etc.):

### Opción A — Configurador local (con acceso físico al device)

1. **Load from file** → `FMC150_Booster_Wave2.cfg`.
2. **Save to device**.
3. Device vuelve a primary plain `telemetry.boosterchile.com:5027`. Records reanudan.

### Opción B — Rollback remoto vía SMS (probado 2026-05-11)

Si no hay acceso físico al device pero la SIM acepta SMS-MT (en Truphone Connect, "SMS MT Service: Active"):

```
  setparam 2020:0;2004:telemetry.boosterchile.com;2005:5027
```

**Crítico**: los 2 espacios líderes son obligatorios porque cfg tiene `1250:0` (SMS Login disabled) con `1251`/`1252` vacíos. Sin los espacios el firmware FMC150 04.01.x descarta el SMS silenciosamente. Tiempo de rollback efectivo: ~30s desde Delivered + reconexión cellular del device.

> Wave 2 sigue siendo soportado por el server (Service `telemetry-tcp-gateway` con port 5027 plain sigue activo). El rollback es inmediato una vez el device aplica el setparam.

---

## §5 — Por qué este es el último wave

Después de Wave 3 estable, los gates G3.4 (DR failover test) y observación >7 días confirman que la flota está lista para escalar. La cfg Wave 3 es la que se carga a cada device nuevo que se incorpora a la flota productiva — no hay Wave 4 planificado.
