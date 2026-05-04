# BUG-010 — Empty states inconsistentes

| | |
|---|---|
| **Severidad** | 🟡 Menor (cosmético) |
| **Componente** | `/app/admin/dispositivos`, `/app/ofertas`, `/app/certificados` |
| **Detectado** | 2026-05-04 |

## Comparación

### `/app/ofertas` (Transportista) — bien
```
[icono inbox]
No hay ofertas activas ahora
Cuando un shipper publique una carga compatible con tus zonas y vehículos,
vas a verla acá. Mantenemos esta vista actualizada cada 30 segundos.
```
✅ Icono + 2 líneas explicativas + información sobre auto-refresh.

### `/app/certificados` (Generador) — bien
```
[icono medalla]
Aún no tenés certificados emitidos
Cuando un viaje entregado se confirme como recibido, el sistema genera el
certificado automáticamente. Te avisamos por email.
[Botón: Ver mis cargas]
```
✅ Icono + explicación + CTA.

### `/app/admin/dispositivos` (Transportista) — pobre
```
No hay dispositivos pendientes.
```
❌ Solo una línea de texto. Sin icono, sin guía sobre cómo aparecerían
dispositivos, sin link a la sección relacionada.

## Fix

Crear un componente `<EmptyState />` reutilizable y migrar las 3 vistas:

```tsx
<EmptyState
  icon={<DeviceIcon />}
  title="Aún no hay dispositivos pendientes"
  description="Cuando un dispositivo Teltonika se conecte por primera vez al gateway, va a aparecer aquí esperando que lo asocies a un vehículo."
  action={{ label: "Ver mis vehículos", href: "/app/vehiculos" }}
/>
```
