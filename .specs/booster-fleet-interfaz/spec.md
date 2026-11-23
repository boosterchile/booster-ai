# Booster Fleet como producto propio — interfaz para la empresa solo de flota

**Estado**: aceptada · **Fecha**: 2026-11-23 · **Pedido y decisiones**: PO (Felipe Vicencio), en la sesión del 2026-11-23

## 1. El problema

Booster vende dos servicios: **Booster** (ofertas de carga entre generadores y
transportistas) y **Booster Fleet** (gestión de flota). El PO necesita que
sus interfaces sean distintas para venderlos por separado.

Desde `.specs/servicios-por-empresa` una empresa transportista puede no
tener ofertas de carga. Pero su interfaz sigue siendo la de Booster con el
menú recortado: el encabezado dice «Booster AI», el Inicio es el del
transportista del marketplace («Tu negocio hoy», «Próximos retiros») y la
sección del menú se llama «Transporte». El primer cliente solo de flota
entraría a un producto que no contrató, con piezas tapadas.

## 2. Decisiones del PO (2026-11-23)

1. **Producto propio en la misma app**: mismo ingreso y misma dirección; la
   empresa de flota ve otro producto, con su marca, su Inicio y su menú.
2. **Para el 2026-11-24**: solo la interfaz de la empresa solo de flota.
3. **Los dos planes** (aclaración del PO el mismo día): **Booster Fleet** es
   solo gestión de flota; **Booster** incluye los dos servicios. Tienen
   tarifas distintas. La interfaz de Booster ya incluye la flota, así que
   la empresa de Booster no pierde nada.

## 3. Entradas

- `GET /me` entrega `empresa.recibe_ofertas_carga`, `is_transportista` e
  `is_generador_carga` de la empresa activa.
- El panel de Booster Fleet existe en `/app/booster-fleet`, para el dueño y
  el admin (`.specs/booster-fleet-rediseno`).
- El menú sale de `navSectionsForMe` y la marca del encabezado, de `Sidebar`.

## 4. Salidas

### 4.1 Qué producto ve una empresa

Una función pura, `productoDe(me)`, devuelve `'fleet'` o `'booster'`:

- `'fleet'`: la empresa activa es transportista, no es generador de carga y
  no recibe ofertas de carga (`recibe_ofertas_carga === false`).
- `'booster'`: todo lo demás, incluidas las empresas con los dos servicios,
  las generadoras, las personas sin empresa y los stakeholders.

No hay cambios de API ni de base de datos.

### 4.2 Interfaz del producto Booster Fleet

- **Marca**: el encabezado del menú dice «Booster Fleet».
- **Inicio**: para el dueño y el admin, `/app` lleva al panel de Booster
  Fleet. Para los demás roles de la empresa, el Inicio es el de la flota,
  sin ofertas ni plata, y se presenta como «Booster Fleet».
- **Menú**, en este orden:

  | Sección | Ítems |
  |---|---|
  | (sin título) | Panel de flota (dueño y admin) o Inicio (otros roles) · Empresa (dueño y admin) · Equipo |
  | Flota | Seguimiento de flota · Trayectos (dueño y admin) · Vehículos · Conductores · Cumplimiento · Dispositivos (dueño y admin) |
  | Viajes propios | Servicios · Rutas (con la API de rutas encendida) |

  No aparecen Ofertas, Cobra hoy, Liquidaciones, Zonas de matching ni la
  sección «Transporte».
- El conductor de una empresa de flota sigue viendo solo «Mi viaje».

### 4.3 Interfaz del producto Booster

Sin cambios: marca «Booster AI», mismo Inicio y mismo menú que hoy.

## 5. Criterios de éxito

1. `productoDe` devuelve `'fleet'` solo para la empresa transportista, no
   generadora, con `recibe_ofertas_carga === false`; con el dato ausente o
   en `true` devuelve `'booster'`.
2. El dueño de una empresa de flota ve la marca «Booster Fleet» y el menú de
   §4.2, y al entrar a `/app` llega al panel de Booster Fleet.
3. Un despachador de una empresa de flota ve la marca «Booster Fleet», el
   Inicio de la flota y el menú de §4.2 sin los ítems de dueño y admin.
4. Una empresa con ofertas de carga ve exactamente la interfaz de antes.
5. `pnpm run ci` en verde y la interfaz vista en un navegador.

## 6. Lo que NO entra

- **Selector de producto** dentro de Booster. El PO lo eligió antes de
  aclarar que Booster incluye los dos servicios en una sola interfaz; queda
  por confirmar si todavía hace falta.
- **Color propio de Booster Fleet.** El sistema de diseño está congelado
  (`docs/frentes-vivos.md`, «Congelados»: no se agregan tokens ni acentos).
  La marca se distingue por nombre, Inicio y menú; el color es decisión del
  PO al descongelar.
- **Apagar Booster Fleet por empresa.** No hace falta: no existe un plan sin
  gestión de flota.
- **Cobro por plan.** La suscripción en UF todavía no distingue el plan
  Booster Fleet del plan Booster (hoy mira `gestion_flota_activada_en`).
- **Dirección propia** (`fleet.…`) y pantalla de ingreso propia.
- **Correos, WhatsApp y el título de la pestaña**: siguen diciendo Booster.
