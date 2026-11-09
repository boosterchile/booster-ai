# Review: recorte-logs-gke-cert-manager

- Spec: .specs/recorte-logs-gke-cert-manager/spec.md
- Fecha: 2026-10-21
- Revisores: code-reviewer y security-auditor (definiciones en `.cursor/agents/`), sobre el diff de la rama. Solo lectura.

## code-reviewer

| Severidad | Hallazgo | Respuesta |
|---|---|---|
| Crítico | La vista previa de `setup-cert-manager.sh` fallaba siempre: `kubectl apply` no acepta `-o custom-columns` | **Corregido.** Ahora usa `-o jsonpath` con `range .items[*]`: con varios documentos, `kubectl apply` devuelve una `List` (probado con un dry-run del servidor de 3 Deployments). La corrección que proponía la revisión, sin `range`, imprimía campos vacíos |
| Advertencia | El rollback documentado (`helm rollback` a la revisión 1) borra la anotación de Workload Identity, que en la revisión 1 está puesta con `kubectl annotate`. Sin ella, el DNS-01 de la renovación del 2026-11-04 falla | **Corregido.** El script, el README y la spec dan el rollback en dos pasos: `helm rollback` y `kubectl annotate … --overwrite`. Después de aplicar, el script también imprime la anotación |
| Advertencia | `cert-manager-values.yaml` nombraba un `cloudbuild-cert-manager.yaml` que no existe | **Corregido** → `setup-cert-manager.sh` |
| Sugerencia | `startupapicheck` es un hook `post-install` solamente en v1.20.2 | **Corregido** el comentario (confirmado en los `jobAnnotations` del chart) |
| Sugerencia | `NOT jsonPayload.MESSAGE=~` da verdadero si falta el campo y descartaría la entrada sin mirarla | **Corregido**: el filtro exige `jsonPayload.MESSAGE:*` (hoy son 0 entradas) |
| Sugerencia | `^(readyz\|livez\|healthz)(/\|$)` es más preciso | **Corregido** |
| Sugerencia | `get-credentials` cambiaba el contexto actual del operador a prod | **Corregido**: kubeconfig temporal con `trap` que lo borra |

## security-auditor

Sin hallazgos críticos ni altos.

| Severidad | Hallazgo | Respuesta |
|---|---|---|
| Medio | Con un token robado de kubelet (`system:node:*`) o de un addon de kube-system, las lecturas de Secrets de un atacante quedarían excluidas. La suplantación no oculta nada: GKE registra en principalEmail a quien llama, y Autopilot no deja suplantar `system:` | **Corregido.** El filtro nunca excluye `io.k8s.core.v1.secrets.*` (~131 entradas/h, ~0,1 GiB/mes) ni entradas con `authoritySelector`. Medido: 0 de 34 operaciones sobre Secrets calzan; el filtro sigue cubriendo el 97,0 % |
| Info | GKE registra algunas escrituras del sistema como `data_access` (subrecursos `status`, TokenReview y SubjectAccessReview), no como `activity` | **Corregida la redacción** del `.tf` y de la spec §6.1. Sin impacto: las escrituras de objetos y las de personas siguen en `activity` |
| Medio | Cadena de suministro: imágenes por tag mutable. El controller lee todos los Secrets y tiene `dns.admin` sobre la zona | **Corregido para las imágenes**: los 4 van fijados por `tag@digest`, iguales a lo que corre hoy. **Residual**: el chart se baja de `charts.jetstack.io` por HTTPS sin verificar la firma. Instalar desde el chart OCI de quay.io con cosign cambia el origen del chart y queda para un PR propio (`.specs/_followups/cert-manager-chart-oci-cosign.md`) |
| Medio | El script dejaba al operador apuntando a prod | **Corregido** (ver arriba) |

Confirmado por la revisión: el sink `_Required` (activity, 400 días) no admite exclusiones; el script no usa `set -x` ni imprime secretos; las exclusiones de nodo y de consola serial no quitan visibilidad de seguridad (crear una VM `gk3-*` para esconderse exige `compute.instances.create`, que queda en activity).
