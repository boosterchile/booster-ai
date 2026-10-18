# Activación del mandato de cobro — lista de verificación (ADR-080 §6)

Encender `MANDATO_COBRO_ACTIVATED` en producción exige **las seis precondiciones con evidencia escrita**. Es el patrón de evidencia previa de ADR-076 §3. El flip lo decide y lo ejecuta el PO por Terraform, y queda registrado en `docs/handoff/CURRENT.md` con fecha y revisión desplegada.

**Gate de calendario: 2026-11-30.** Si a esa fecha no se cumple la precondición 3, el peak de enero a marzo de 2027 se opera en modo conector. La decisión se registra en `docs/handoff/CURRENT.md` en noviembre.

Estado al 2026-10-10 (este PR):

| # | Precondición | Estado | Evidencia hoy | Falta |
|---|---|---|---|---|
| 1 | **Sign-off legal escrito**: mandato de cobro, fondos de terceros como no captación y fuera del perímetro CMF, y cláusulas del contrato del match | ❌ | Borradores en boosterchile/booster-ai#768 (`docs/legal/adendum-mandato-cobro-v1.md`, `contratos-por-rol-v1.md`), sin revisión de abogado | Opinión escrita del abogado y `lawyer_review: <fecha>` en el frontmatter de cada documento (T10-28) |
| 2 | **Cuenta bancaria de fondos de terceros** abierta y conciliación diaria operando | ❌ cuenta · 🟡 conciliación | El sistema registra cobros y transferencias con evidencia y concilia a diario (`POST /admin/jobs/mandato-cobro-conciliacion`, este PR) | Apertura de la cuenta (banco, número, mandato del titular) y una semana de conciliación diaria registrada |
| 3 | **Capital de trabajo**: confirming (ruta 1) o doble estructura (ruta 2) aprobada y probada, **o** decisión escrita del PO de operar con caja propia bajo tope | ❌ | El tope se aplica en código: `MANDATO_COBRO_FLOAT_MAXIMO_CLP` vale 0 por omisión, así que sin decisión Booster no adelanta caja propia | Línea aprobada y una operación de prueba, **o** la decisión escrita del PO con el monto del tope |
| 4 | **Protección de datos**: autorización explícita del conductor para usar RUT, licencia y ubicación (ley vigente desde diciembre de 2026), incorporada al onboarding | ❌ | Borrador `docs/legal/consentimientos-v2.md` en #768. El onboarding no la pide hoy | Texto revisado por el abogado y paso de consentimiento en el onboarding del conductor |
| 5 | **Recepción conforme de punta a punta**: documento subido y confirmación del generador desde la interfaz | 🟡 → ✅ con este PR | Ya existían el API `confirmar-recepcion`, el panel de documentos y `REQUIRE_DOCUMENT_TO_CLOSE`. **Faltaba** el botón del generador: ninguna pantalla llamaba a `confirmar-recepcion`. Este PR lo agrega y registra `recepcion_conforme` con el documento como evidencia | Prueba en producción con un viaje real, después del merge |
| 6 | **T&Cs v3 y adendum de pronto pago v2** publicados y aceptados por las partes | ❌ | Borradores de T&C v3 y del adendum de mandato en #768. El adendum Cobra Hoy v1 describe cesión con tarifa fija | Revisión del abogado, publicación y aceptación registrada de las partes |

Leyenda: ✅ cumplida con evidencia · 🟡 parcial · ❌ pendiente.

## Corrida en seco antes del flip (ADR-076 §3)

1. En staging, o en el entorno no-prod que defina el PO, con `MANDATO_COBRO_ACTIVATED=true` y un tope de prueba:
   - un viaje v3 con documento y confirmación del generador produce `recepcion_conforme`;
   - `GET /admin/mandato-cobro` muestra los vencimientos;
   - una liberación sobre el tope se rechaza con `tope_float_excedido`;
   - un cobro registrado baja el float;
   - el job de conciliación marca mora en un viaje vencido (con plazos de prueba).
2. Guardar la salida de cada paso en este archivo, con la fecha.
3. Recién con las seis precondiciones en ✅, el PO aplica el flag por Terraform en producción.
