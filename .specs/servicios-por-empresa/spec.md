# Servicios por empresa — un transportista sin ofertas de carga

**Estado**: aceptada · **Fecha**: 2026-11-23 · **Pedido y decisiones**: PO (Felipe Vicencio), en la sesión del 2026-11-23

## 1. El problema

Booster le ofrece dos servicios a una empresa de transportes: las **ofertas
de carga** (el matching con generadores, y la plata que sale de ahí) y
**Booster Fleet** (el control de su flota). Hoy toda empresa transportista
recibe los dos: el menú, el Inicio y el API no distinguen.

El primer cliente que entra a operar solo necesita Booster Fleet. Por las
características de sus servicios no usa el matching. Con el producto como
está, su dueño vería Ofertas, Cobra hoy, Liquidaciones y Zonas de matching,
y un Inicio que le promete que «empiezan a llegarte ofertas».

Medido en prod el 2026-11-23 (solo lectura): esa empresa es transportista,
tiene 2 vehículos con Teltonika, 0 zonas de matching y 0 ofertas. El
matching exige una zona en la región de origen, así que hoy no le llegaría
ninguna oferta; lo que falta es que el producto lo diga y lo sostenga.

## 2. Decisiones del PO (2026-11-23)

1. **Quién activa**: el platform-admin, por empresa, desde el panel. Igual
   que el contrato programado y la tarifa de Booster Fleet.
2. **Qué conserva una empresa sin ofertas de carga**: Booster Fleet,
   Seguimiento de flota, Trayectos, Vehículos, Conductores, Cumplimiento,
   Dispositivos, Equipo y Empresa; y además sus **viajes propios**
   (Servicios, Rutas y «viaje propio»), con su huella.
3. **Plazo**: todo en un solo cambio, antes del 2026-11-24.

## 3. Entradas

- `empresas` ya tiene las banderas por empresa que decide el platform-admin
  (`gestion_flota_activada_en`, `contrato_programado_activado_en`), con su
  sección en `/app/platform-admin/configuracion-comercial`.
- Las capacidades (`packages/shared-schemas/src/domain/capacidades.ts`) ya
  deciden en un solo lugar, para la web y el API, quién acepta ofertas
  (`puedeAceptarOferta`) y quién ve la plata (`puedeVerFinanzas`).
- El matching (`apps/api/src/services/matching.ts`) elige candidatas entre
  las empresas transportistas activas con zona en la región de origen.

## 4. Salidas

### 4.1 Base de datos (migración 0089, expand-only)

Tres columnas nuevas en `empresas`:

| Columna | Tipo | Significado |
|---|---|---|
| `recibe_ofertas_carga` | `boolean NOT NULL DEFAULT true` | La empresa participa del matching y ve Ofertas y la plata |
| `recibe_ofertas_carga_cambiado_en` | `timestamptz` nulo | Cuándo lo cambió el platform-admin por última vez |
| `recibe_ofertas_carga_cambiado_por` | `text` nulo | Correo del platform-admin que lo cambió |

El valor por defecto es `true`: ninguna empresa existente cambia de
comportamiento y la migración no toca filas.

### 4.2 Capacidades

`CapacidadCtx` gana `recibeOfertasCarga` (opcional; ausente equivale a
`true`, para no romper a quien arma el contexto sin el dato).

- `puedeAceptarOferta` es `false` si la empresa no recibe ofertas. Con eso
  el API rechaza con 403 aceptar, rechazar y reclamar una oferta, y
  responder un cambio de carga.
- `puedeVerFinanzas` es `false` si la empresa no recibe ofertas. Con eso el
  API rechaza Cobra hoy y Liquidaciones.

### 4.3 API

- **Matching**: una empresa con `recibe_ofertas_carga = false` no es
  candidata, aunque tenga zona y vehículo.
- **`GET /me`**: cada `empresa` de las membresías trae
  `recibe_ofertas_carga`.
- **Panel** (solo platform-admin):
  - `GET /admin/configuracion-comercial/ofertas-carga` lista las empresas
    transportistas con `{ empresaId, razonSocial, rut, activo, cambiadoEn,
    cambiadoPor }`.
  - `PUT /admin/configuracion-comercial/ofertas-carga/:empresaId` con
    `{ activo: boolean }` cambia la bandera y registra quién y cuándo. 404
    si la empresa no existe o no es transportista.

### 4.4 Web

Para una empresa transportista con `recibe_ofertas_carga = false`:

- **Menú**: no aparecen Ofertas, Cobra hoy, Liquidaciones ni Zonas de
  matching. Lo demás queda igual.
- **Inicio**: no aparecen el bloque Ofertas, el aviso de Cobra hoy ni los
  accesos a Ofertas, Cobra hoy y Liquidaciones. La tarjeta de empresa nueva
  no promete ofertas.
- **URL directa** a `/app/ofertas` o `/app/zonas`: la pantalla dice que el
  servicio no está activo para la empresa, sin listar ni dejar editar.
- **Panel**: sección «Ofertas de carga» en
  `/app/platform-admin/configuracion-comercial`, junto a «Booster Fleet»,
  con un botón por empresa para habilitar o deshabilitar.

## 5. Criterios de éxito

1. Una empresa con `recibe_ofertas_carga = false`, con zona en la región de
   origen y un vehículo que sirve, **no recibe oferta** al correr el
   matching; la misma empresa con `true` sí. Rojo exhibido antes del
   arreglo.
2. Con la bandera apagada, `puedeAceptarOferta` y `puedeVerFinanzas` son
   `false` para el dueño; con la bandera encendida o ausente no cambian.
3. El platform-admin apaga y enciende la bandera desde el panel; queda
   registrado quién y cuándo. Una empresa que no es transportista no se
   puede cambiar.
4. `GET /me` entrega `recibe_ofertas_carga` de la empresa activa.
5. El menú y el Inicio de una empresa sin ofertas no muestran Ofertas,
   Cobra hoy, Liquidaciones ni Zonas de matching, y sí muestran Booster
   Fleet, Servicios y el resto de la flota.
6. Una empresa existente, sin tocar, ve y hace exactamente lo mismo que
   antes del cambio.
7. `pnpm run ci` en verde.

## 6. Lo que NO entra

- **Apagar Booster Fleet por empresa.** La pantalla de Booster Fleet sigue
  disponible para todo transportista y su bandera sigue gobernando solo la
  tarifa, como fija `.specs/booster-fleet/spec.md` §1 y §6. Que una empresa
  tenga ofertas de carga y no tenga Booster Fleet es otra decisión, con su
  propio efecto en el cobro.
- **Que el dueño active o desactive servicios por su cuenta.**
- **Elegir los servicios al crear la empresa** en el panel o en el alta por
  enlace. La empresa nace con ofertas de carga y el platform-admin las
  apaga después.
- **Cobro.** La suscripción en UF no mira esta bandera.
- **Ofertas ya emitidas.** Apagar la bandera no cancela ofertas pendientes
  ni asignaciones en curso; la empresa deja de poder aceptarlas. Para una
  empresa con operación de marketplace en curso, el platform-admin espera a
  que cierre antes de apagar.
