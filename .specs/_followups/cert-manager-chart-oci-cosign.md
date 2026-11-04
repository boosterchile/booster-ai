# cert-manager — instalar el chart desde OCI con firma verificada

**Dimensión**: security (cadena de suministro) · **Estado**: pendiente, no urgente
**Fuente**: revisión de seguridad de `.specs/recorte-logs-gke-cert-manager/review.md` (2026-10-21)

## Problema
`infrastructure/k8s/setup-cert-manager.sh` baja el chart `jetstack/cert-manager` v1.20.2 de `https://charts.jetstack.io` por HTTPS, sin verificar la firma. Las imágenes ya van fijadas por digest en `cert-manager-values.yaml`, pero un chart alterado podría renderizar otros objetos: más RBAC, otro ServiceAccount o un contenedor extra.

## Impacto
El controller de cert-manager lee todos los Secrets del clúster y, por Workload Identity, tiene `roles/dns.admin` sobre la zona del dominio (`wave-3-tls.tf`). Un chart comprometido en el momento de aplicar podría secuestrar el DNS de `boosterchile.com`. La exposición ya existía con el `helm install` original; el script la vuelve el camino oficial.

## Qué hacer
1. Instalar desde el chart OCI de quay.io (`oci://quay.io/jetstack/charts/cert-manager`, misma versión v1.20.2) y verificar la firma con `cosign verify` antes del `helm upgrade`. La identidad y el issuer esperados se toman de la documentación de cert-manager.
2. Fijar el digest del artefacto OCI del chart en el script, igual que se hizo con las imágenes.
3. Confirmar que `helm template` con el chart OCI da los mismos objetos que el de `charts.jetstack.io` (diff vacío) antes de cambiar el origen.

## Criterio de cierre
`setup-cert-manager.sh` corta si la firma o el digest del chart no coinciden, y el README de `infrastructure/k8s/` documenta cómo actualizar ambos al subir de versión.
