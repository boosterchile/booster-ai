# Spec: reemision-certificado

- **Author**: agente (Claude), por encargo del PO
- **Date**: 2026-11-11
- **Status**: Aceptada por el PO en el chat del 2026-11-11 («Acepto las cinco»), con las decisiones de §8.
- **Linked**: [ADR-021](../../docs/adr/021-glec-v3-compliance.md), `.specs/huella-consolidada/verify.md` (hallazgos del 2026-11-11), `apps/api/src/services/certificados-versionados.ts` (HC-001 parte 3a, #870)
- **Frente**: sin slot. Nace de un hallazgo sobre un certificado emitido.

## 1. Objetivo

Poder corregir un certificado ya emitido cuando lo impreso no calza con el
cálculo que lo respalda: emitir una versión nueva, firmada, que reemplaza a la
anterior sin borrarla, y que quien verifique la versión antigua sepa que fue
reemplazada.

El caso que la motiva es uno. La spec lo resuelve con un mecanismo que sirva
para el siguiente.

## 2. Estado verificado

Código en main (`bc099658`) y producción consultada en solo lectura el
2026-11-11.

### 2.1 El certificado afectado

De los 8 certificados emitidos, uno imprime un factor de emisión que no
explica su cifra:

| Dato | Valor |
|---|---|
| Estimado | 2026-10-30, con el factor 3,25 kg CO₂e/L |
| Cerrado y emitido | 2026-11-03, con el factor 3,24 (vigente desde #872, 2026-11-02) |
| Combustible | 182,33 L |
| Emisiones reales guardadas | 590,746 kg CO₂e = 182,33 × 3,24 |
| Factor guardado en `metricas_viaje` | 3,25 |
| Factor que el PDF imprime | el guardado: 3,25 (según `generar-pdf-base.ts`; el PDF no se abrió) |

La cifra de emisiones es correcta. Lo incorrecto es el factor que la acompaña:
182,33 × 3,25 da 592,573.

La causa está corregida para los certificados futuros en #926: el cierre
guarda el factor con que calculó.

Los otros 7 certificados no tienen este problema. Los 6 anteriores al cambio
de factor imprimen 3,25 y se calcularon con 3,25.

### 2.2 Lo que existe para versionar

- La tabla `certificados_viaje` (migración 0067): versión, estado (`vigente`,
  `reemplazado`, `revertido`), huella del PDF, fecha y puntero a la versión que
  la reemplazó.
- `crearVersion` y `revertirVersion`, que mueven la versión vigente y espejan
  las cuatro columnas `certificado_*` de `metricas_viaje` en una transacción.
- El endpoint público de verificación: si le llega la huella de una versión
  que no es la vigente, responde que la firma es auténtica, que la versión ya
  no rige y cuál la reemplazó.

### 2.3 Lo que falta

1. **La emisión no registra la versión 1.** `emitirCertificadoViaje` escribe
   solo en `metricas_viaje`. En producción la tabla de versiones tiene una
   fila: la que sembró la migración 0067 para un viaje puntual. Los otros 7
   certificados, incluido el afectado, no tienen versión registrada.
2. **Nadie llama a `crearVersion` ni a `revertirVersion`.** Están escritas y
   probadas, sin camino que las use. `crearVersion` falla si el viaje no tiene
   una versión vigente.
3. **La emisión no reemite.** Si el viaje ya tiene certificado, responde
   `already_issued` y no hace nada.
4. **No hay forma de corregir el dato.** El factor guardado del viaje afectado
   solo cambia con una escritura a mano en producción.

Hoy no se puede reemitir un certificado sin escribir código nuevo.

## 3. Reglas

### 3.1 Toda emisión queda versionada

Emitir un certificado registra su versión 1 en `certificados_viaje` en la
misma transacción que hoy actualiza `metricas_viaje`.

### 3.2 Reemitir

Reemitir un certificado es, en este orden:

1. corregir el dato de `metricas_viaje` que estaba mal, con una guarda que
   compruebe el valor anterior y que el nuevo cuadra con el resto de la fila;
2. generar el PDF desde `metricas_viaje`, como en una emisión;
3. firmarlo y subirlo al bucket con un nombre de objeto propio de la versión;
4. registrar la versión nueva con `crearVersion`, que deja la anterior como
   `reemplazado`;
5. dejar un evento del viaje con el motivo, quién lo pidió y las dos huellas.

Los pasos 4 y 5 van en una transacción. Si el 2 o el 3 fallan, la base no
cambia.

### 3.3 Lo que nunca hace

- No borra ni sobrescribe el PDF anterior ni su firma.
- No recalcula emisiones. Reemitir corrige cómo se presenta un cálculo, no el
  cálculo. Recalcular un certificado emitido sigue fuera de alcance
  (`.specs/huella-consolidada/` §7).
- No reemite en lote.

### 3.4 Motivo

Cada reemisión lleva un motivo de una lista cerrada. El primero:
`factor_impreso_no_corresponde`.

### 3.5 Quién

Lo ejecuta el PO, con un job manual que corre en seco por defecto y que para
escribir exige confirmar el destino, como `hc001-fuente-combustible-can`. No
hay endpoint.

## 4. Contratos públicos que cambian

Son decisión del PO.

| Contrato | Cambio |
|---|---|
| Esquema de base | `certificados_viaje` agrega `motivo_reemision` (texto, opcional). Migración `expand`. |
| Certificado | Una versión mayor que 1 dice su número de versión, la fecha de la que reemplaza y el motivo (§8-2). |
| Verificación pública | Sin cambio: ya informa versión reemplazada y vigente. |

## 5. Entrega por partes

| # | Qué entra | Visto del PO |
|---|---|---|
| 1 | La emisión registra la versión 1. Sin cambio visible. | no |
| 2 | Relleno: versión 1 para los 7 certificados que no la tienen, copiada de `metricas_viaje`. Toca datos. | sí, con corrida en seco |
| 3 | Migración `expand` (`motivo_reemision`) y el servicio de reemisión, con tests. Sin job. | sí: esquema |
| 4 | Plantilla: texto de versión y motivo en el certificado reemitido. | sí: certificado |
| 5 | Job de reemisión, en seco por defecto. Corrida en seco registrada sobre el certificado afectado. | sí |
| 6 | El PO ejecuta la reemisión del certificado afectado. | la ejecuta el PO |

## 6. Fuera de alcance

- Guardar con cada certificado los insumos con que se calculó (factor, perfil
  del vehículo), para poder reproducirlo. Es el otro hallazgo del 2026-11-11 y
  merece su propia spec.
- Recalcular emisiones de certificados emitidos.
- Avisar por correo o WhatsApp de un reemplazo, salvo lo que decida §8-1.
- Reemisión desde el panel.

## 7. Criterios de éxito

1. Test de integración: emitir deja una fila `vigente`, versión 1, y
   `metricas_viaje.certificado_vigente_id` apuntando a ella.
2. Corrida en seco del relleno sobre una copia de producción: 7 versiones por
   crear, 1 ya existente, 0 certificados sin versión al terminar.
3. Tests del servicio: reemitir crea la versión 2, deja la 1 como
   `reemplazado`, espeja `metricas_viaje` y registra el evento; con el dato
   anterior distinto del esperado no escribe nada; si firmar o subir falla, la
   base no cambia.
4. Test de la verificación pública: con la huella de la versión 1 después de
   reemitir responde «reemplazado por v2»; con la de la versión 2, válido.
5. Test del certificado reemitido: imprime el factor corregido, y los litros
   por ese factor dan la cifra de emisiones impresa.
6. El PDF y la firma de la versión 1 siguen en el bucket después de reemitir.
7. Tests, lint, typecheck y build en verde; cobertura ≥ 80 % en el código
   nuevo.

Es dominio crítico: primero el test, con el rojo en la evidencia del PR.

## 8. Decisiones del PO (2026-11-11)

El PO aceptó las cinco recomendaciones.

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿El generador se entera de que su certificado fue reemplazado? | Sí, con un aviso corto y el certificado nuevo. Ya tiene el PDF anterior, y quien lo verifique verá «reemplazado». Enterarse por un tercero es peor que un aviso. |
| 2 | ¿El certificado nuevo dice que reemplaza a otro, y por qué? | Sí: versión, fecha de la anterior y motivo en una línea. Un certificado que cambia sin decirlo no resiste una auditoría. |
| 3 | ¿Se reemite solo el certificado afectado? | Sí. Los 6 anteriores al cambio de factor son coherentes: imprimen 3,25 y se calcularon con 3,25. |
| 4 | ¿Se hace el relleno de la versión 1 para los otros certificados (parte 2)? | Sí. Sin él, `crearVersion` no funciona para ellos y el próximo caso empieza de cero. |
| 5 | ¿Vale la pena el mecanismo para un solo certificado, o se corrige a mano? | El mecanismo. La corrección a mano exige firmar y subir un PDF fuera del sistema y escribir en tres tablas sin tests. Las partes 1 a 3 además cierran lo que HC-001 parte 3a dejó sin conectar. |

## 9. Riesgos

- **El certificado afectado sigue circulando** con un factor que no explica su
  cifra hasta que se reemita.
- **Firmar y subir no son transaccionales con la base.** Un fallo entre subir
  el PDF y registrar la versión deja un objeto huérfano en el bucket, nunca
  una versión sin PDF. El job lo informa.
- **La llave de firma.** La versión nueva se firma con la versión de llave
  vigente; la anterior conserva la suya. Ninguna se destruye
  (`docs/runbooks/incidentes-glec.md`).
