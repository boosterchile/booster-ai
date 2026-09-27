# Spec — Capacidades máximas del equipo de telemetría

**Estado**: pedida por el PO el 2026-09-23. El modelo en uso es el FMC150. Pueden entrar otros equipos. Al conocer el detalle, se extraen las capacidades máximas que Booster sabe interpretar.

## Entradas

- Modelo conocido: `FMC150` o el GPS del móvil del conductor.
- Modelo desconocido, con detalle: protocolo, cantidad de sensores Dallas, si tiene CAN, si tiene GNSS.

## Salidas

- Función pura `extraerCapacidadesMaximas` en `packages/shared-schemas`.
- Para el FMC150, el techo es el catálogo AVL ya versionado (Codec 8 y 8E, GNSS, hasta 4 Dallas entre −55 °C y 125 °C, CAN LVCAN, eventos).
- Para un equipo desconocido, el techo es la intersección entre lo que el detalle declara y lo que esos catálogos saben leer. No se inventan sensores por encima de 4 Dallas ni CAN fuera de los IDs ya mapeados.

## Criterios de éxito

1. `FMC150`, `fmc-150` y `Teltonika FMC150` devuelven el mismo techo, con CAN y 4 Dallas.
2. El GPS del móvil devuelve GNSS y no CAN.
3. Un detalle inválido falla en Zod, antes de armar el resultado.
4. El eco-routing queda descrito como característica esencial en `README.md`.
5. Las instrucciones vivas del repo no mandan a usar `agent-rigor` ni `booster-skills`. Los ADR y las specs históricas no se reescriben.
