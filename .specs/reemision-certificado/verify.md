# Verificación: reemision-certificado

## Parte 1 — toda emisión queda versionada (2026-11-11)

`emitirCertificadoViaje` registra la versión 1 en `certificados_viaje` dentro
de la misma transacción que marca el certificado como emitido, y deja
`metricas_viaje.certificado_vigente_id` apuntando a ella
(`registrarPrimeraVersion` en `services/certificados-versionados.ts`).

- Nada visible cambia: las cuatro columnas `certificado_*` de `metricas_viaje`
  se escriben igual que antes.
- El relleno de certificados (`jobs/backfill-certificados.ts`) pasa por la
  misma función, así que también versiona.
- Si el viaje ya tuviera una versión, las restricciones de la tabla rechazan
  la segunda y la emisión no se registra. No ocurre en el flujo normal: un
  certificado ya emitido se omite antes (`already_issued`).

### Criterio 1 de la spec

`test/integration/certificado-version-1.integration.test.ts`: la emisión deja
una fila `vigente`, versión 1; con ella registrada `crearVersion` crea la
versión 2 y espeja las métricas; un viaje no puede tener dos versiones 1; si la
transacción falla, la versión no queda.

`test/unit/emitir-certificado-viaje.test.ts`: la emisión llama al registro con
los datos del PDF firmado y de la decisión de fuente, y el UPDATE de las
métricas incluye el id de la versión.

### Lo que no cubre

- No hay un test que firme y suba un PDF real: KMS y el bucket se simulan,
  igual que en los tests que ya existían.
- Los 7 certificados emitidos antes de este cambio siguen sin versión. Es la
  parte 2 (relleno, con visto del PO).
