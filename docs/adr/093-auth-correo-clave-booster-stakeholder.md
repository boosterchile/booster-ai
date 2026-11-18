# ADR-093 — Correo + clave para personal Booster y Stakeholders

**Estado**: Vigente. Decisión del PO en el chat del 2026-11-16.
**Fecha**: 2026-11-16
**Decider**: Felipe Vicencio (Product Owner)
**Supersede en método de login a**:
- [ADR-035](./035-auth-universal-rut-clave-numerica.md), **solo** para los tipos de usuario **Booster** (personal de plataforma, `es_admin_plataforma`) y **Stakeholder** (`stakeholder_sostenibilidad` / organizaciones stakeholder ADR-034). El resto de ADR-035 (RUT + clave numérica para generador, transportista y conductor; selector de tipo; subdominios; recovery WhatsApp para esos roles) **sigue vigente**.
**Related**:
- [ADR-028](./028-rbac-auth-firebase-multi-tenant-with-consent-grants.md) (Firebase IdP; Admin Booster = `es_admin_plataforma`; Stakeholder = org + consent grants)
- [ADR-034](./034-stakeholder-organizations.md) (alta stakeholder solo por platform-admin; RUT opcional en corporativo ESG internacional)
- Spec: [`.specs/auth-correo-clave-booster-stakeholder/spec.md`](../../.specs/auth-correo-clave-booster-stakeholder/spec.md)

---

## Contexto

ADR-035 migró **todos** los roles a RUT + clave numérica de 6 dígitos. En producción `AUTH_UNIVERSAL_V1_ACTIVATED=true`: `/login` muestra el selector universal; correo/Google queda detrás de `?legacy=1`.

El alta del personal Booster (`.specs/alta-personal-booster`, `.specs/acceso-panel-plataforma`) exige que el **admin** cargue correo + nombre + RUT, emite un código y la persona activa en `/activar` con RUT + código + clave numérica. El login canónico de esos invitados es tarjeta «Booster» + RUT + clave.

El 2026-11-16 el PO acotó el producto:

1. Los invitados al personal (`gerencia@boosterchile.com`, `sandoval.felipe@gmail.com`) son **usuarios nuevos**. Debe llegarles un **correo** (From canónico `contacto@boosterchile.com`) a una **interfaz de creación de usuario** donde **ellos** consignen sus datos.
2. **Correo + clave** (Firebase email/password) para quienes ingresan como **Booster** (personal plataforma) y **Stakeholders**. El resto de usuarios sigue con **RUT + clave** numérica.

Eso cierra el conflicto «ADR-035 universal vs pedido correo+clave» **sin** reabrir RUT+clave para generador / transportista / conductor.

Hoy no hay bypass legítimo: inventar un alta con `?legacy=1` o un `generatePasswordResetLink` suelto contradice las specs vigentes y deja el login universal pidiendo RUT a quien el PO quiere en correo+clave.

## Decisión

### 1. Método de autenticación por tipo (selector de `/login`)

| Tipo en el selector | Credencial de login | Vigencia |
|---|---|---|
| Generador de carga | RUT + clave numérica | ADR-035 intacto |
| Transporte | RUT + clave numérica | ADR-035 intacto |
| Conductor | RUT + clave numérica | ADR-035 intacto |
| **Stakeholder** | **Correo + clave (password Firebase)** | **Este ADR** |
| **Booster** | **Correo + clave (password Firebase)** | **Este ADR** |

El selector sigue siendo **hint de vista**, no autorización (ADR-035 / ADR-028). El rol real viene de memberships / `es_admin_plataforma`.

### 2. Alta de usuarios nuevos (personal Booster y Stakeholders)

- El admin invita con el **correo** (y el vínculo de rol/org que ya exija cada flujo). **No** inventa la clave ni obliga a conocer de antemano el RUT/nombre si el flujo es de usuario nuevo.
- Sale un correo From `Booster <contacto@boosterchile.com>` con enlace a una **UI Booster** de creación de cuenta (no basta la pantalla genérica de reset de Firebase como única UI de alta).
- En esa UI la persona consigna sus datos y elige su clave. Tras completar, puede entrar con correo + clave en el tipo correspondiente.
- Principio de identidad: nadie más que la persona conoce su clave.

### 3. Qué no cambia

- Firebase Auth sigue siendo el único IdP (ADR-028).
- Generador, transportista y conductor: RUT + clave numérica, `/activar` con código, recovery WhatsApp según ADR-035.
- Acceso al panel: sigue la regla de `.specs/acceso-panel-plataforma` (`es_admin_plataforma` + estado, con lista Terraform de respaldo).
- Stakeholder como entidad: ADR-034 / ADR-028 (org XOR empresa, consent grants). Este ADR solo cambia **cómo se autentican**.

### 4. Coexistencia y legacy

- `?legacy=1` deja de ser el camino de producto para Booster/Stakeholder: el form correo+clave pasa a ser el form del tipo en el selector.
- Cuentas Booster/Stakeholder ya activas solo con RUT+clave numérica: migración / coexistencia detallada en la spec (no en este ADR). Hasta implementarla, no se invita con el flujo viejo a los dos correos pendientes.

## Alternativas consideradas

### Alt 1 — Seguir con `/activar` + RUT+clave y pedir RUT al PO

**Rechazada por el PO.** Los invitados son usuarios nuevos y deben crear la cuenta ellos; el login pedido es correo+clave.

### Alt 2 — Solo `generatePasswordResetLink` (Firebase Hosted UI) sin pantalla Booster

**Rechazada como camino completo.** Sirve para fijar password en Firebase (patrón de `approveSignupRequest`), pero no cubre «interfaz de creación de usuario donde consignen sus datos» ni alinea el selector `/login` (tipos Booster/Stakeholder hoy piden RUT). Puede reutilizarse **como pieza** detrás de la UI Booster, no como producto final.

### Alt 3 — Volver `AUTH_UNIVERSAL_V1_ACTIVATED=false` en prod

**Rechazada.** Rompería RUT+clave para generador/transportista/conductor, que el PO mantiene.

## Consecuencias

**Positivas.** Producto alineado al pedido del PO; ADR-035 deja de bloquear invitaciones Booster/Stakeholder; el From `contacto@` y Firebase email/password ya existen en el stack.

**Negativas / trabajo.** Hay que implementar la UI de creación, el mail de invitación con token, el branch de login por tipo, y actualizar `.specs/alta-personal-booster` / invitación stakeholder. Hasta entonces **no** se envían mails de alta a `gerencia@` / `sandoval.felipe@` por el flujo RUT actual.

**Specs.** Contratos y criterios en `.specs/auth-correo-clave-booster-stakeholder/spec.md`. Las specs de alta personal / acceso panel registran el supersede en su decision log; no se inventa bypass en código antes de esa implementación.
