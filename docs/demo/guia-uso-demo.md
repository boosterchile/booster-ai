# Guía de uso del demo Booster AI

Esta guía explica cómo correr el demo end-to-end de Booster AI mostrando las 12 features del sprint. Incluye todos los usuarios, credenciales y el flujo paso a paso por cada rol.

---

## 1. Prerequisitos

Antes de poder usar el demo necesitas:

1. **PR #157 mergeado a `main`** → migrations corren auto al startup de Cloud Run.
2. **Tu email en `BOOSTER_PLATFORM_ADMIN_EMAILS`** (env var del API) — para poder gatillar el seed.
3. **Tu Firebase ID token** — lo obtienes desde devtools del browser cuando estás logueado en `app.boosterchile.com`:
   ```js
   // Pegado en la consola de devtools:
   firebase.auth().currentUser.getIdToken().then(t => console.log(t))
   ```

---

## 2. Gatillar el seed

Una vez merge y allowlist OK, ejecuta:

```bash
TOKEN="<tu-firebase-id-token>"

curl -X POST https://api.boosterchile.com/admin/seed/demo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

Respuesta (guarda esto — el PIN no se vuelve a mostrar):

```json
{
  "ok": true,
  "credentials": {
    "shipper_owner": {
      "email": "demo-shipper@boosterchile.com",
      "password": "BoosterDemo2026!"
    },
    "carrier_owner": {
      "email": "demo-carrier@boosterchile.com",
      "password": "BoosterDemo2026!"
    },
    "conductor": {
      "rut": "12.345.678-5",
      "activation_pin": "<6 dígitos>"
    },
    "carrier_empresa_id": "...",
    "shipper_empresa_id": "...",
    "vehicle_with_mirror_id": "...",
    "vehicle_without_device_id": "..."
  }
}
```

El seed es **idempotente** — corriéndolo de nuevo no duplica entidades, sólo regenera el PIN del conductor si todavía está pendiente de activar.

---

## 3. Todos los usuarios del demo

### Sintéticos creados por el seed

| Usuario | Identificador | Credencial | Empresa | Rol |
|---|---|---|---|---|
| Dueño Andina Demo | demo-shipper@boosterchile.com | password `BoosterDemo2026!` | Andina Demo S.A. (RUT 76.999.111-1) | dueno (shipper) |
| Dueño Transportes Demo Sur | demo-carrier@boosterchile.com | password `BoosterDemo2026!` | Transportes Demo Sur S.A. (RUT 77.888.222-K) | dueno (carrier) |
| Pedro González | RUT `12.345.678-5` | PIN 6 dígitos (del seed response) | Transportes Demo Sur | conductor |

### Cuenta real preexistente

| Usuario | Identificador | Empresa | Vehículo |
|---|---|---|---|
| Transportes Van Oosterwyk | (tu cuenta real) | Transportes Van Oosterwyk | VFZH-68 · Teltonika IMEI `863238075489155` |

**Importante**: el seed NO toca esta cuenta. El vehículo demo DEMO01 lee la misma telemetría de Van Oosterwyk via `teltonika_imei_espejo`, pero Van Oosterwyk sigue siendo dueño primary del device.

### Entidades creadas en el seed

**Andina Demo S.A. (shipper)**:
- Sucursal 1: Bodega Maipú · Av. Pajaritos 1234 · Maipú · XIII
- Sucursal 2: CD Quilicura · Av. Lo Echevers 555 · Quilicura · XIII

**Transportes Demo Sur S.A. (carrier)**:
- Vehículo DEMO01 · Volvo FH 460 (2024) · Diesel · 14 000 kg · Camión pesado · `teltonika_imei_espejo='863238075489155'` (mira data real de Van Oosterwyk)
- Vehículo DEMO02 · Ford Cargo 815 (2022) · Diesel · 5 500 kg · Camión pequeño · sin device (para demo GPS móvil)
- Conductor Pedro González · licencia A5 · vencimiento 2028-12-31

---

## 4. Walkthrough paso a paso

### A. Como shipper — `demo-shipper@boosterchile.com`

1. **Login**: `https://app.boosterchile.com/login` → email + password.
2. **Dashboard `/app`**: vas a ver cards para "Crear carga", "Mis cargas", **"Sucursales"** (D7b), **"Certificados de huella de carbono"** (D5).
3. **Click en "Sucursales"** → ves las 2 ya seedadas. Puedes:
   - Crear nueva sucursal (form con 16 regiones chilenas).
   - Editar cualquiera (badge "Sin coords" si faltan lat/lng).
   - Retirar (soft delete).
4. **Click en "Crear carga"** → publica una oferta. Origen Bodega Maipú, destino CD Quilicura por ejemplo (demuestra el caso "transporte entre sucursales").
5. **Click en "Certificados"** → al pie, ves el card "Cómo calculamos la huella de carbono" con la metodología GLEC v3 + ejemplo Santiago → Concepción (D5).

### B. Como carrier — `demo-carrier@boosterchile.com`

1. **Login**: mismo `/login`, email + password.
2. **Dashboard `/app`**: cards para transportista:
   - **Seguimiento de flota** (D3) → primer card
   - Ofertas activas
   - Vehículos
   - **Conductores** (D8)
   - **Cumplimiento** (D6)
   - Modo Conductor
   - Cobra hoy
3. **Aceptar oferta** (si publicaste una desde el shipper): click "Ofertas activas" → acepta. Asigna DEMO01 o DEMO02 + el conductor Pedro González. Esto crea la asignación que el conductor luego ve.
4. **Click en "Vehículos"** → ves DEMO01 y DEMO02 con placas SVG visibles (D4 — marco negro + escudo Carabineros).
5. **Click en una placa o "Editar"** → detalle del vehículo (D3 separado del tracking):
   - Banner "Teltonika asociado" con botón "Ver en vivo".
   - Form de datos del vehículo (capacidad, combustible, etc.).
   - **Sección "Documentos legales"** (D6) → carga revisión técnica, SOAP, permiso de circulación. Pega URL de Drive/Dropbox como `archivo_url`.
6. **Click en "Seguimiento de flota"** (D3) → `/app/flota`:
   - Mapa con DEMO01 mostrando data **real** del Teltonika de Van Oosterwyk (badge "mirror").
   - DEMO02 sin posición hasta que el conductor active GPS móvil.
   - Lista lateral con cards por vehículo + badges de fuente de datos.
7. **Click en "Conductores"** → lista con Pedro González:
   - Badge "Pendiente login" hasta que active.
   - Click en él → detalle con form de licencia + **sección Documentos** del conductor.
   - Carga licencia, antecedentes, examen psicotécnico.
8. **Click en "Cumplimiento"** (D6) → dashboard:
   - 3 cards de resumen: vencidos · por vencer (30 días) · total.
   - Tabla "Vehículos" con docs por vencer (semáforo de urgencia).
   - Tabla "Conductores" igual.
   - Si no hay docs vencidos → empty state celebrativo.
9. **Caso dueño-conductor** (D10): en "Conductores → Nuevo conductor", verás un checkbox **"Soy yo el conductor"**. Al activarlo:
   - Prellena RUT + nombre del dueño actual.
   - Al crear NO se devuelve PIN (el dueño ya tiene email/password).
   - Después de crear, el dueño accede a "Modo Conductor" directo desde el dashboard.

### C. Como conductor — Pedro González (RUT 12.345.678-5)

1. **Login**: `https://app.boosterchile.com/login/conductor`
   - Ingresa RUT `12.345.678-5`
   - Ingresa el PIN de 6 dígitos del seed response
2. **Primera vez (activación, D9)**: el backend crea el Firebase user con email sintético `drivers+123456785@boosterchile.invalid`, mintea custom token, te loguea automáticamente.
3. **Logins siguientes**: mismo form, mismo RUT + mismo PIN (que ahora funciona también como password).
4. **Auto-redirect** (D9 surface guard): si entras a `/app` te lleva a `/app/conductor/modo`. No tienes acceso a ofertas/vehículos/cargas/conductores del carrier.
5. **En `/app/conductor/modo`**:
   - Card "Audio coaching automático" (toggle existente).
   - Card "Permisos del navegador" → permite mic + GPS.
   - **Card "Reporte GPS móvil (sin Teltonika)"** (D2):
     - Pega el `assignment_id` del viaje activo (lo obtienes del carrier al asignar).
     - Click "Iniciar reporte" → empieza a postear posición al backend cada actualización del GPS.
     - Feedback en vivo: "Reportando posición · N puntos enviados · lat,lng actual".
   - Card "Comandos de voz disponibles".
6. **El carrier ve la posición**: vuelve a `/app/flota` desde la cuenta carrier — DEMO02 ahora tiene posición con badge `browser_gps`.

### D. Como Van Oosterwyk (cuenta real)

- Login con sus credenciales habituales.
- Su vehículo VFZH-68 sigue funcionando como antes con su Teltonika real.
- La data del IMEI 863238075489155 fluye normalmente a Van Oosterwyk AND simultáneamente se refleja en el vehículo DEMO01 del carrier demo (via columna `teltonika_imei_espejo`).
- **Cero contaminación** — Van Oosterwyk no ve nada del demo.

---

## 5. Demostrar D11 (stakeholder geo)

Pendiente de crear el user con rol `stakeholder_sostenibilidad`. Si quieres demostrar la surface ahora:

1. Crea manualmente un user con membership rol `stakeholder_sostenibilidad` en Andina Demo o Transportes Demo Sur (o en una empresa stakeholder dedicada).
2. Login con ese user → `/app/stakeholder/zonas`.
3. Ves dashboard con 5 zonas predefinidas (Puerto Valparaíso, Puerto San Antonio, Lo Valledor, Polo Quilicura, ZOFRI Iquique) con data ILUSTRATIVA. La integración con agregaciones reales sobre trips queda follow-up.

---

## 6. Limpieza

Cuando el demo termine, ejecuta:

```bash
curl -X DELETE https://api.boosterchile.com/admin/seed/demo \
  -H "Authorization: Bearer $TOKEN"
```

Borra todas las empresas con `es_demo=true` + cascada (vehículos demo, conductores demo, sucursales demo, memberships, users-conductores que sólo existen para el demo). Van Oosterwyk queda intocado.

---

## 7. Mapa de features → URL → quién la demuestra

| Feature | URL | Rol que la demuestra |
|---|---|---|
| D4 Placa visual | `/app/vehiculos`, `/app/vehiculos/$id`, `/app/flota` | Carrier |
| D3 Seguimiento separado del edit | `/app/flota`, `/app/vehiculos/$id` | Carrier |
| D7 Modelo conductor | (interno — soporta D8/D9/D10) | — |
| D8 CRUD conductores | `/app/conductores`, `/app/conductores/nuevo`, `/app/conductores/$id` | Carrier |
| D9 Login RUT + PIN + driver surface | `/login/conductor`, `/app/conductor/modo` | Conductor |
| D7b Sucursales shipper | `/app/sucursales`, `/app/sucursales/nueva` | Shipper |
| D10 Dueño-conductor | `/app/conductores/nuevo` (checkbox) | Carrier dueño |
| D1 Seed demo + IMEI espejo | `/app/flota` (badge "mirror" en DEMO01) | Admin → Carrier |
| D2 GPS móvil sin Teltonika | `/app/conductor/modo` (card "Reporte GPS móvil") | Conductor |
| D5 Metodología GLEC v3 | `/app/certificados` (card al pie) | Shipper |
| D11 Stakeholder geo | `/app/stakeholder/zonas` | Stakeholder |
| D6 Compliance + documentos | `/app/cumplimiento`, secciones inline en detalle vehículo/conductor | Carrier |

---

## 8. Troubleshooting

- **"forbidden_platform_admin"** al gatillar seed → tu email no está en `BOOSTER_PLATFORM_ADMIN_EMAILS`. Pídeselo a IT.
- **Conductor no puede activar (invalid_credentials)** → o el PIN está mal escrito, o se gatilló de nuevo el seed y se regeneró. Pide el nuevo PIN al admin que corrió el seed.
- **DEMO01 no muestra posición en `/app/flota`** → verifica que el Teltonika de Van Oosterwyk esté emitiendo (el espejo lee los puntos por `imei`, si no hay, no hay).
- **DEMO02 no muestra GPS** → el conductor tiene que estar en `/app/conductor/modo` con el reporte activo Y haber permitido GPS en el browser Y tener un `assignment_id` válido.
- **No veo card de Cumplimiento** → la card aparece para roles transportistas. Si estás como shipper, no la verás.
