# Plan

1. Funciones puras y matriz de tests en `packages/shared-schemas`.
2. Migración 0065 y columna en el schema Drizzle. `/me` calcula la ficha por RUT y devuelve el flag de la membresía.
3. El API deja de comparar roles a mano en ofertas, plata, flota, lista de asignaciones, cargas y el alta de equipo. El chat de un visualizador no escribe.
4. La web arma el contexto con `ctxDesdeMe` y muestra u oculta cada acción. El conductor empleado que abre una ruta del shell vuelve a `/app/conductor`.

El PR #816 no se reimplementa. Los chequeos que se reemplazan están citados en `CHEQUEOS_REEMPLAZADOS`.
