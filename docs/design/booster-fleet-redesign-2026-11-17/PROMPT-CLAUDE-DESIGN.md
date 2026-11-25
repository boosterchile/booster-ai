# Prompt listo para pegar en Claude Design

Copiá todo el bloque siguiente. Adjuntá también `CONTEXT.md`. Si tenés capturas de la UI actual, adjuntálas **solo en el chat de Claude Design** (no las subas a un repo público).

---

Sos diseñador de producto para **Booster AI**, logística B2B en Chile. Necesito una **propuesta de rediseño UI/UX de Booster Fleet** (pantalla del dueño de la empresa de transportes), no un rediseño de toda la plataforma.

## Contexto

Booster Fleet ya está en producción. Hoy es una página con tres bloques de texto/tablas (Combustible, Documentos, Mantenciones). El Product Owner dice que es básica, poco intuitiva y anticuada respecto de la imagen de Booster. Te adjunto el documento de contexto de marca/tokens y, si están disponibles, capturas de la UI actual (solo como referencia privada).

Identidad (resumen):
- Promesa: “Transporta más, impacta menos.”
- Sentimiento: rápido, sin fricción, simple — vara Stripe/Linear.
- Personalidad: “buena onda” chilena, solo en momentos (vacíos/éxitos), no en tablas.
- Marca producto: verde `#1FA058`, neutrales cálidos `#FAF9F7`, urgencia ámbar `#F58A00`. Tipografía Inter + JetBrains Mono para patentes. **No uses fucsia de marketing.**

## Usuario

Dueño/admin de flota bajo presión. Quiere en segundos: qué está mal y qué hacer. Densidad de operador, no cards gigantes de conductor.

## Qué debe mostrar (prioridad)

1. **Combustible** (7 días): señales por vehículo (posible robo → sin telemetría → sin sensor → consumo alto → en orden). KPI de flota.
2. **Documentos**: hallazgos de vehículos y conductores (faltante / vencido / por vencer).
3. **Mantenciones**: vencidas / próximas / programadas + forma clara de programar.

## Pedido

Generá **3 direcciones visuales distintas** (A/B/C) para desktop ~1440px:

Para cada dirección:
1. Artboard **Overview** Booster Fleet (command center, no listado CRUD).
2. Artboard **Detalle** de un vehículo con alerta grave.
3. Artboard **Empty state** de mantenciones (con buena onda dosificada).

Además:
- Prototipo clicable overview → detalle.
- Lista de componentes reutilizables (KPI, badge de severidad, fila de flota, alerta documental, card de mantención).
- 5–8 bullets de rationale: por qué esta jerarquía ayuda al dueño.

## Restricciones

- No predicción de mantenciones.
- No edición de archivos en esta pantalla.
- No cambiar tarifa ni lógica de combustible.
- No rediseñar login ni marketing.
- Evitá: purple gradients, glass, glow, dashboards genéricos de IA, paredes de texto, Excel disfrazado.

## Criterio de éxito

En 3 segundos se entiende cuántas cosas están mal y cuál es la más urgente. Combustible manda visualmente. Cada hallazgo sugiere una acción. Se ve producto Booster, no admin de principiantes.

Empezá por la dirección A y después explorá B y C con layouts estructuralmente distintos (no solo otro color).
