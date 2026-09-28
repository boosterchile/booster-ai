# Spec — la primera página de Admin es un índice, y cada pantalla vuelve

**Slug**: `platform-admin-hub` · **Fecha**: 2026-09-28 ·
**Autorización PO**: revisar el diseño y que todas las páginas de este flujo
puedan volver o regresar.

## Problema

`/app/platform-admin` abre con los formularios de empresas, Teltonika,
stakeholders e impersonación uno debajo del otro. Algunas funciones ya son
páginas propias (solicitudes, algoritmo, observabilidad, sitio) y otras no.
Quien entra no elige: tiene que scrollear. En flota, el alta de vehículo y
los dispositivos de la empresa, el regreso es una flecha sin texto.

## Decisión

La primera página de Admin es un índice de accesos. Cada función abre su
página y esa página tiene un enlace «Volver» a `/app/platform-admin`. El
índice vuelve al login. En el flujo de flota de este trabajo, el regreso
lleva texto: inicio, lista de vehículos o historial, según corresponda.

## Alcance

- Índice en `/app/platform-admin`.
- Páginas nuevas: empresas, Teltonika, stakeholders, impersonar.
- «Volver» visible en dispositivos de la empresa, lista y alta de vehículos,
  detalle de vehículo y listado de trayectos.

**No se toca**: contratos de API, ni el contenido de cada formulario.

## Criterios de éxito

- [x] El índice enlaza las ocho funciones y no monta el formulario de Teltonika ni el de crear empresa.
- [x] Empresas, Teltonika, stakeholders e impersonar tienen «Volver» a `/app/platform-admin`.
- [x] Dispositivos de la empresa, vehículos, alta, detalle y trayectos muestran un regreso con texto.
