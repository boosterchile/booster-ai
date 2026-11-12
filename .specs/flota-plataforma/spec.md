# Spec: flota de todas las empresas en el panel de plataforma

- **Fecha**: 2026-11-12
- **Estado**: alcance pedido por el PO en el chat del 2026-11-11: página nueva
  en el panel, con mapa, ficha al seleccionar, lectura de CAN, y viajes y
  certificados. El contrato de §4 espera su visto en el PR.
- **Fuera de slot**: lo pide el PO (`CLAUDE.md`, ciclo de trabajo, punto 1).

## 1. Problema

El panel de plataforma muestra los vehículos de una empresa a la vez, y solo
dentro de «Teltonika», para asociar un equipo. Para saber dónde está la flota
de los clientes, qué equipos leen el CAN o cómo salieron los certificados de un
camión, hoy hay que consultar la base.

Caso que lo dejó a la vista (2026-11-11): cuatro camiones envían el
combustible por CAN (elemento 83) y solo dos lo tienen configurado como fuente
de la huella. No hay pantalla donde eso se vea.

## 2. Qué se construye

Una página de solo lectura, **Flota**, en `/app/platform-admin/flota`:

1. **Mapa** con la última posición conocida de cada vehículo de todas las
   empresas.
2. **Lista** de todos los vehículos, con búsqueda por patente o empresa y
   filtro por empresa. Incluye los que no tienen posición.
3. **Ficha** al seleccionar un vehículo, en el mapa o en la lista:
   - datos del vehículo y su empresa;
   - equipo Teltonika y última señal;
   - **lectura de CAN**: qué fuente de combustible tiene configurada para la
     huella y qué envía de verdad el equipo;
   - **viajes y certificados**: cuántos viajes entregó y con qué nivel salieron
     sus certificados, y sus últimos viajes.

No modifica nada. Configurar la fuente de CAN o asociar un equipo se sigue
haciendo donde hoy.

## 3. Quién la ve

Solo quien ya tiene acceso al panel de plataforma (`requirePlatformAdmin`,
`.specs/acceso-panel-plataforma`). No se crea un rol nuevo: el PO eligió la
página dentro del panel actual.

La posición de los vehículos de un cliente es un dato operacional sensible.
Cada consulta de la lista y de una ficha queda en el log con el correo de quien
la hizo, y cuenta en `flota_plataforma_consultas_total{vista}`.

## 4. Contrato (decide el PO)

### 4.1 `GET /admin/plataforma/flota`

```json
{
  "vehiculos": [
    {
      "id": "uuid",
      "patente": "KZXB64",
      "empresa": { "id": "uuid", "nombre": "Transportes Andes Ltda." },
      "tipo": "camion_pesado",
      "capacidad_kg": 28000,
      "estado": "activo",
      "teltonika_imei": "861234567890123",
      "fuente_combustible_can": "83",
      "posicion": {
        "latitud": -33.45,
        "longitud": -70.66,
        "velocidad_kmh": 62,
        "registrada_en": "2026-11-12T01:20:00Z",
        "fuente": "teltonika"
      }
    }
  ]
}
```

- `posicion` es `null` si el vehículo nunca reportó una coordenada válida.
- `posicion.fuente`: `teltonika` (equipo propio), `espejo` (IMEI espejo) o
  `movil` (GPS del celular del conductor).
- Ordenada por empresa y patente. Sin paginación: hoy son decenas de
  vehículos; el tope es 2.000 y, si se alcanza, la respuesta trae
  `"truncada": true`.

### 4.2 `GET /admin/plataforma/flota/:id`

```json
{
  "vehiculo": {
    "id": "uuid",
    "patente": "KZXB64",
    "empresa": { "id": "uuid", "nombre": "Transportes Andes Ltda.", "rut": "77.111.222-3" },
    "tipo": "camion_pesado",
    "marca": "Scania",
    "modelo": "R450",
    "anio": 2021,
    "combustible": "diesel",
    "capacidad_kg": 28000,
    "peso_vacio_kg": 9000,
    "consumo_l_por_100km_base": 32,
    "capacidad_estanque_l": 400,
    "estado": "activo",
    "teltonika_imei": "861234567890123",
    "teltonika_imei_espejo": null
  },
  "can": {
    "fuente_configurada": "83",
    "ventana_dias": 3,
    "puntos": 24216,
    "con_combustible_83": 24039,
    "con_nivel_84": 24038,
    "con_nivel_89": 24040,
    "ultima_lectura_en": "2026-11-12T01:20:00Z",
    "aviso": null
  },
  "viajes": {
    "entregados": 1,
    "en_curso": 0,
    "certificados": {
      "primario_verificable": 0,
      "secundario_modeled": 1,
      "secundario_default": 0,
      "sin_certificado": 0
    },
    "ultimos": [
      {
        "codigo_seguimiento": "BOO-HC7DJX",
        "estado": "entregado",
        "entregado_en": "2026-10-20T18:00:00Z",
        "nivel_certificacion": "secundario_modeled",
        "certificado_emitido": true
      }
    ]
  }
}
```

- `can` es `null` si el vehículo no tiene equipo Teltonika propio.
- `can.aviso`:
  - `envia_83_sin_configurar`: el equipo envía el combustible por CAN y la
    fuente configurada no es `83`. La huella de ese camión no usa el CAN.
  - `configurado_83_sin_lecturas`: está configurado `83` y el equipo no lo
    envió en la ventana.
  - `null` en los demás casos.
- `viajes.ultimos`: los 10 más recientes del vehículo, en cualquier estado.
- 404 `vehiculo_not_found` si el id no existe.

### 4.3 Interfaz

Entrada «Flota» en el menú del panel. La página tiene el mapa arriba, la lista
abajo y la ficha al costado (debajo en pantallas angostas). El marcador
seleccionado se destaca. Un vehículo sin posición aparece en la lista con
«Sin posición».

## 5. Arquitectura

- La búsqueda de la última posición por vehículo (equipo propio, espejo o
  celular) hoy está escrita dentro de `GET /vehiculos/flota`. Se extrae a un
  servicio y lo usan esa ruta y la nueva. La respuesta de `/vehiculos/flota` no
  cambia.
- Ruta nueva `routes/admin-flota-plataforma.ts`, montada en
  `/admin/plataforma/flota`, con `requirePlatformAdmin` en cada handler.
- La lectura de CAN de la ficha cuenta sobre `telemetria_puntos` de los
  últimos 3 días del vehículo, por el índice `(vehiculo_id, timestamp_device)`.
- Web: `routes/platform-admin-flota.tsx`, con `FleetMap`, que ya existe.

## 6. Fuera de alcance

- Editar vehículos, configurar la fuente de CAN o asociar equipos desde aquí.
- Recorrido histórico del vehículo en el mapa.
- Un rol aparte del administrador de plataforma.
- Actualización en vivo: la página se refresca cada 60 segundos.

## 7. Criterios de éxito

1. Sin acceso al panel, las dos rutas responden 403 y no leen vehículos; sin
   sesión, 401.
2. La lista trae vehículos de más de una empresa, cada uno con su empresa, y la
   posición sale de la fuente que corresponde (propio, espejo o celular).
3. La ficha marca `envia_83_sin_configurar` para un vehículo que envía el 83 y
   tiene otra fuente configurada, y `configurado_83_sin_lecturas` en el caso
   inverso.
4. La ficha cuenta los viajes entregados del vehículo y sus certificados por
   nivel.
5. `GET /vehiculos/flota` responde lo mismo que antes de extraer el servicio
   (sus tests no cambian).
6. La página muestra el mapa, la lista filtra por texto y por empresa, y al
   seleccionar un vehículo aparece su ficha. Comprobado en el navegador.
7. Tests, lint, typecheck y build en verde; cobertura ≥ 80 % en el código
   nuevo.

El guard de acceso es dominio crítico (auth): su test va primero, con el rojo
en la evidencia del PR.

## 8. Riesgos

- **Datos de clientes a la vista del personal de Booster.** Es el mismo
  alcance que ya da la impersonación, sin entrar a la cuenta. Queda registro
  por consulta (§3).
- **Costo de la consulta de última posición** si la flota crece: es un
  `DISTINCT ON` por vehículo sobre la telemetría. Con los índices parciales de
  coordenada válida (migración 0070) hoy responde rápido; se revisa si la
  lista pasa de cientos de vehículos.
