# Booster Fleet — lectura sin espera: plan

Spec: [`spec.md`](./spec.md). Dos PRs, de a uno. La serie termina cuando los
10 criterios de la spec §5 están cubiertos por tests, el criterio 9 está
medido en producción y el cambio está en `main`.

Los dos PRs se pueden desplegar por separado y en cualquier orden: sin el
parámetro `?combustible=guardada`, el API responde igual que antes.

## PR 1 — El API guarda la lectura con su hora

Criterios 1 a 5 y 8.

- [x] La lectura de combustible se guarda con el instante en que se hizo,
      hasta 24 horas. La clave ya no lleva el tramo de reloj.
- [x] Con menos de 10 minutos desde la lectura, se responde con ella.
- [x] Con más, y hasta 24 horas, se entrega solo con
      `?combustible=guardada`, con `al_dia` falso.
- [x] Sin el parámetro, una lectura de más de 10 minutos no sirve: se lee
      y se espera.
- [x] `combustible.leido_en` y `combustible.al_dia` en el esquema y en el
      panel. Una lectura que no pasó por la caché es del instante de la
      consulta y está al día.
- [x] Un valor desconocido en `combustible` responde 400.
- [x] La métrica de duración de la lectura lleva si salió al día.
- [x] Tests primero, con el rojo en la Evidencia del PR.

Decisiones tomadas en este PR:

- La clave pasa a `fleet:combustible:v2`. Lo guardado con la clave anterior
  vence solo en 10 minutos; no se migra.
- El instante de la lectura es el de su inicio: la ventana de 7 días
  termina ahí.
- Una lectura en curso no bloquea a quien acepta la guardada: recibe la
  guardada de inmediato.
- El guardado sigue sin esperarse; la respuesta no depende de Redis.

## PR 2 — La pantalla muestra la guardada y pide la nueva

Criterios 6, 7 y 9.

- [x] La primera petición va con `?combustible=guardada`.
- [x] Siempre muestra «Combustible leído a las HH:MM», en hora de Santiago.
- [x] Con `al_dia` falso, muestra «actualizando…», pide el panel sin el
      parámetro y reemplaza las cifras al llegar.
- [x] Si esa petición falla, conserva las cifras y dice de qué hora son.
- [ ] Medir el criterio 9 en producción después del despliegue.

Decisiones tomadas en este PR:

- Si la lectura es de otro día en Santiago, la línea lleva la fecha:
  «Combustible leído el mar 17 nov, 18:02». Con solo la hora, una lectura
  de ayer se leería como de hoy.
- El detalle del vehículo comparte la consulta del panel y recibe la
  lectura nueva cuando llega; no muestra la línea de la hora.
- Visto en local el 2026-11-18 con la cuenta del seed: con la lectura
  guardada envejecida 20 horas, la pantalla hizo las dos peticiones y quedó
  con la lectura nueva. El estado «actualizando…» dura milisegundos en
  local y solo quedó cubierto por test.

## Fuera de esta serie

- Bajar el tiempo de la lectura completa.
- La tarea programada para la primera apertura del día (spec §7.3).
