# Instructivo Wave 3 — FMC150 (delta sobre Wave 2)

> **Pre-requisito**: el device debe estar corriendo `FMC150_Booster_Wave2.cfg` con records llegando estables. Si Wave 2 está OK, este delta agrega TLS dual-endpoint (primary 5061 + DR backup) sin tocar nada de la lógica de telemetría.

> **Backup obligatorio**: antes de tocar nada, **Save to file** la cfg actual del device como `FMC150_Booster_Wave2.cfg` (si no la tenés ya). Eso queda como rollback.

---

## §1 — `GPRS → Server Settings` (primary → TLS)

| Campo | Wave 2 actual | Wave 3 |
|---|---|---|
| Domain | `telemetry.boosterchile.com` | `telemetry-tls.boosterchile.com` |
| Port | `5027` | `5061` |
| Protocol | TCP | TCP (TLS va por encima) |
| **TLS Encryption** | None | **TLS** |

> El cert es Let's Encrypt (CA pública). El FMC150 valida contra su trust store interno — no hace falta subir CA al device.

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

1. **Load from file** → `FMC150_Booster_Wave2.cfg`.
2. **Save to device**.
3. Device vuelve a primary plain `telemetry.boosterchile.com:5027`. Records reanudan.

> Wave 2 sigue siendo soportado por el server (Service `telemetry-tcp-gateway` con port 5027 plain sigue activo). El rollback es inmediato.

---

## §5 — Por qué este es el último wave

Después de Wave 3 estable, los gates G3.4 (DR failover test) y observación >7 días confirman que la flota está lista para escalar. La cfg Wave 3 es la que se carga a cada device nuevo que se incorpora a la flota productiva — no hay Wave 4 planificado.
