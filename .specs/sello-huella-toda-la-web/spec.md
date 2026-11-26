# El sello de huella en toda la web (frente 2 del rediseño)

**Estado**: pedida por el PO el 2026-11-26 (goal de la sesión) · **Fecha**: 2026-11-26

Implementa la parte del frente 2 de
[`docs/design/rediseno-2026-11-25/FRENTES.md`](../../docs/design/rediseno-2026-11-25/FRENTES.md)
que pide el goal: **no existe cifra de emisiones sin sello en la web**, con las
tres presentaciones de [ADR-091](../../docs/adr/091-sello-estimado-por-fuente-de-distancia.md).
La parte del criterio que depende de T10-05 (el primer certificado de nivel
primario se distingue a simple vista) queda fuera.

## 1. Qué hay en `main` (`121e0d22`)

- `FootprintSeal` (`packages/ui-components`, #1083) dibuja las tres
  presentaciones: `primario` → «Medido»; `medido_teltonika` → «Distancia
  medida con Teltonika · consumo modelado», sin «Medido»; `estimado` →
  «Estimado» (decisión 2 del PO del 2026-11-25).
- `presentacionNivel` (`packages/certificate-generator`) es la única función
  que decide la presentación; el API la usa en rutas y en Flota de la
  plataforma.
- Toda cifra de emisiones de `apps/web` pasa por `lib/formato-emisiones.ts`
  (frente 1). Solo `rutas` y Flota de la plataforma llevan sello. Sin sello:
  `OfferCard`, el Inicio del generador, Certificados, el detalle de carga
  (`cargas`), el resultado del conductor, los indicadores del Inicio del
  panel, el observatorio y las zonas de organizaciones.
- El resultado del conductor dice «Huella medida» cuando hay emisión real,
  aunque la huella no haya sido medida: contradice la decisión 2.
- Los totales de Certificados, del Inicio del generador y del panel suman
  todas las clases en una sola cifra.

## 2. Entradas

- `nivel_certificacion`, `fuente_dato_ruta` y `cobertura_pct` de
  `metricas_viaje`, los mismos que lee el certificado.

## 3. Salidas

### 3.1 API

- `services/presentacion-huella.ts`: `presentacionDesdeMetricas(m)` envuelve
  `presentacionNivel` para una fila de métricas (valores nulos, cobertura en
  texto). Es el único punto del API que la calcula para la web.
- `serializeTripMetrics` (detalle de carga y resultado del conductor) agrega
  `presentacion`.
- `GET /certificates`: cada certificado agrega `presentacion`; `resumen`
  agrega `por_presentacion`, con certificados, kg y ahorro por presentación.
  Lo hereda `GET /admin/plataforma/indicadores`.
- Campos nuevos, aditivos: ningún campo existente cambia.

### 3.2 Web

- `components/huella/CifraHuella.tsx`: `CifraHuella` escribe una cifra de
  emisiones (o de intensidad) con su `FootprintSeal` al lado; la presentación
  es obligatoria. `TotalHuella` escribe un total con una línea por
  presentación: ningún total mezcla clases.
- Es el único archivo, además del formateador, que llama a
  `formatoEmisiones` o `formatoIntensidad`.
- Cada pantalla usa la presentación que entrega el API. Dos casos sin dato
  por viaje llevan «Estimado» con su motivo:
  - la oferta (`OfferCard`) y la emisión estimada antes del viaje: son
    proyecciones previas al viaje;
  - el observatorio: la vista de BigQuery agrega todos los viajes en una
    cifra y no guarda la presentación. Separarla exige cambiar la vista y un
    `terraform apply` del PO; mientras tanto el agregado es «Estimado», la
    presentación conservadora de ADR-091 ante un dato que no se puede
    clasificar.
- Las zonas de organizaciones dejan de mostrar la cifra de emisiones de
  demostración: era un número fijo en el código, no una huella.
- El ejemplo de cálculo de Certificados lleva «Estimado»: su distancia y su
  consumo son modelados.
- El resultado del conductor y el detalle de carga dejan de decir «Huella
  medida» o «Emisiones reales» y muestran el sello.
- El nivel del Inicio del panel cuenta las tres presentaciones.

## 4. Criterios de éxito

1. `presentacion-huella.test.ts` cubre todas las filas de la tabla de
   ADR-091 §1, incluidos nivel, fuente o cobertura ausentes (TDD, rojo
   exhibido: dominio GLEC).
2. `resumen-certificados` separa kg, ahorro y conteo por presentación (test
   de integración contra Postgres).
3. `CifraHuella.test.tsx`: las tres presentaciones, «Sin dato» sin sello y
   `TotalHuella` con una línea por clase.
4. `sin-cifras-de-emisiones-sueltas.test.ts` falla si un archivo distinto del
   formateador y de `CifraHuella.tsx` llama a `formatoEmisiones` o
   `formatoIntensidad`.
5. Prueba Playwright `apps/web/e2e-conductor/sello-huella.spec.ts`: con la
   siembra del frente 1 (un certificado por presentación), recorre
   Certificados, el detalle de carga y el Inicio del panel, falla si alguna
   cifra de emisiones visible no está dentro de una `CifraHuella` con sello, y
   exige ver las tres presentaciones.
6. `pnpm run ci` en verde.

## 5. Fuera de alcance

- El primer certificado de nivel primario distinguible (depende de T10-05).
- La tabla de qué se midió, el nivel con la frase de qué faltaría, anticipar
  la huella al elegir transportista o crear un viaje propio, la medición en
  Empresa, «Pedir a Booster» y el viaje propio certificado: el resto del
  frente 2.
- Separar el observatorio por presentación (vista de BigQuery + `apply`).
- El PDF del certificado: ya sigue ADR-091.
