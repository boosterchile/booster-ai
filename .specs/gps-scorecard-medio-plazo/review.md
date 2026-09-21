# Review — scorecard GPS de medio plazo

- No toca `calcularCoberturaPura`, `CONTINUITY_GAP_S` ni `clasificar-cobertura-cero`.
  Un test fija que un fix cada 3 min da 80 % en este scorecard: no es el % del certificado.
- `cambiaStack` es el literal `false`. No hay endpoint, flag ni cron.
- La edad es el desfase de recepción, etiquetado. La compuerta no se presenta como
  la edad de captura del browser.
- KPI 3 no fabrica heartbeat: sin consulta el % es null. El batch sí consulta
  `telemetria_puntos` y un device ausente del `GROUP BY` es 0 filas, no null.
- El espejo no cuenta como device ni entra al dual.
- Cohorte demo / `es_usuario_prueba` se filtra en SQL y otra vez en memoria.
- Métricas sin id de viaje ni de empresa.
- Índice por `asignacion_id`: no se agrega. El batch usa `idx_posmovil_vehiculo_ts`.
