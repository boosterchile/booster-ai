# Fase B — Decisiones del PO (pivote documental DTE)

Decisiones para los frentes **F3** (remover Sovos/DTE) y **F4** (repositorio documental de terceros). Se commitean con el primer PR de Fase B.

---

## O-3 (RESUELTA — PO 2026-06-18): Retención legal de documentos de terceros archivados

Política de retención del repositorio documental (F4):

- **Plazo mínimo: 6 años desde `fecha_emision`** (campo extraído del TED), **NO** desde `created_at`. Fundamento: **Código Tributario (DL 830) Art. 17 en relación con Art. 200** — plazo extraordinario de prescripción del SII de 6 años. Se adopta el extraordinario por ser la postura conservadora.
- **Prohibido el borrado automático dentro del período**: NO configurar lifecycle rules de Cloud Storage que eliminen objetos antes del vencimiento; NO borrado en cascada al cerrar/archivar una orden de transporte.
- **Campo `retention_until`** en `documentos_transporte`, persistido = `fecha_emision + 6 años`. **Fallback conservador** si no se pudo extraer `fecha_emision` (`manual_entry` sin fecha, o `failed`): `created_at + 6 años` **+ marcar el registro para revisión**.
- **Borrado solo después de `retention_until`**, mediante proceso **explícito y auditable** (job que registra qué se borra, cuándo y por qué regla), **nunca silencioso**. Detrás de flag **`ENABLE_RETENTION_PURGE=false`** por defecto. **En esta fase NO se implementa purga real** — solo el cálculo y almacenamiento de `retention_until`.
- **Cloud Storage**: considerar transición a almacenamiento frío (Nearline/Coldline) para objetos antiguos como optimización de costo, **sin eliminar** dentro del período de retención.
- **Sign-off legal pendiente**: la responsabilidad contractual de custodia de Booster (broker/transportista) vs. la obligación legal del emisor/receptor debe ser **confirmada por el equipo legal** antes de fijar el plazo definitivo y los SLAs de custodia. Los 6 años son el **default técnico seguro**; legal puede ajustarlo.

**Implicancia para P0-A**: el bucket de documentos (hoy retention 6a, `is_locked=false`) pasa a almacenar documentos de **terceros** bajo esta política. El retention-lock del **emisor** (P0-A) deja de aplicar (Booster no emite DTE); la retención de terceros se rige por esta política, **sin WORM lock obligatorio** salvo que legal lo exija (decisión separada).

---

## O-2 (RESUELTA — PO 2026-06-18): `facturas_booster_clp` sobrevive; deprecar solo `dte_*`

`facturas_booster_clp` conserva su función de **registro de comisiones de Booster** (dato de negocio vivo + histórico) y **NO se borra**. Solo las columnas `dte_*` (folio/provider/status), que existían por la emisión vía Sovos, se **deprecan**: dejan de escribirse, se marcan `legacy`/`deprecated` en el schema, **SIN DROP** ni migración destructiva. Booster sigue registrando qué cobra; simplemente ya no emite el DTE de esas comisiones por el sistema. Coherente con la regla de no borrar datos históricos en la remoción de Sovos.

## O-5 (RESUELTA — PO 2026-06-18): WASM puro para lo crítico, `sharp` acotado al preprocesamiento

**WASM puro** para lo crítico: rasterizar PDF con `@hyzyla/pdfium` y decodificar PDF417 con `zxing-wasm`. **`sharp` permitido SOLO para preprocesamiento de imagen de fotos** (escala de grises, contraste, corrección de perspectiva). Justificación: `sharp` se instala con binarios precompilados vía npm (no requiere `apt-get` ni libvips gestionado a mano en el Dockerfile), así que el contenedor sigue sin dependencias de sistema instaladas manualmente; su calidad de preprocesamiento es clave para la tasa de éxito de decodificación de fotos en terreno. El espíritu del brief (Dockerfile reproducible, sin gestión manual de binarios de sistema) se respeta; el "todo WASM" se relaja solo para `sharp` por calidad de imagen.
