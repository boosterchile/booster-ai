# Review: retiro-es-demo-auth-hot-path

- El chain productivo queda en firebase auth → userContext → impersonation-write-guard. No hay branch que lea `is_demo` en cada request.
- Los módulos `demo-expires` e `is-demo-enforcement` siguen en el repo, sin import desde `server.ts`. Reimportarlos dispara el guard.
- Cuentas reales: el middleware anterior hacía passthrough cuando el claim no era demo. Sacarlo no cambia status ni body.
- Tokens residuales con `is_demo: true` dejan de recibir 403 `forbidden_demo` y 401 `demo_account_expired` por este chain. No hay login demo que los emita. Rollback = revert.
- No se tocó Identity Platform, DNS, Terraform ni `.github/workflows/*`. El job `is-demo-wire-completeness` sigue invocando el mismo script; el veredicto del script ahora es el inverso.
