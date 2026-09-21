# Ship: retiro-es-demo-auth-hot-path

- Commit: `fix(auth): retira enforcement es_demo del request path`
- Merge: squash a `main` cuando CI esté verde. No es deploy: `release.yml` es `workflow_dispatch`.
- Rollback: revert del PR. Vuelve el chain `demoExpires` + `isDemoEnforcement` y el guard que exigía ese wire.
