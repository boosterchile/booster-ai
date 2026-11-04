# docs/compliance/

Documentación de cumplimiento regulatorio y certificaciones externas de Booster AI.

## Contenido

| Archivo | Propósito |
|---|---|
| `glec-rfp.md` | RFP de verificación externa de la metodología GLEC v3.0 (T10-27): alcance, entregables, criterios de aceptación y registro de envíos |
| `glec-certification-YYYY.pdf` | Certificado emitido por auditor (post-cierre) |
| _(futuros)_ | reportes de auditoría, evidencia de samples, ADRs de metodología certificada |

## Reglas

- Esta carpeta **no contiene secretos**. Los datos sample para auditores se envían en canales separados (correo cifrado / SFTP del vendor); acá solo viven los pointers + metadata.
- Toda evidencia de certificación debe tener trazabilidad git (commit + PR) más el archivo PDF original (no editado).
- ADRs que documenten metodología certificada van en `docs/adr/` (no acá), con `Refs:` apuntando a la evidencia en este folder.

## No-goals

- Esto no es repositorio de templates legales generales. Los términos comerciales (T&C, contratos shipper/carrier/driver/stakeholder) viven en `docs/legal/`.
- Booster no emite DTE ni se integra con el SII (ADR-069); no hay certificación tributaria que archivar aquí.
