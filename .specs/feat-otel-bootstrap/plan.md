# Plan: feat-otel-bootstrap

- Spec: .specs/feat-otel-bootstrap/spec.md
- Created: 2026-06-11
- Status: Complete

### T1 [DONE]: packages/otel-bootstrap (NodeSDK + Cloud Trace + gating) + tests
### T2 [DONE]: instrumentation.ts + tsup entry + Dockerfile --import en los 5 servicios; deps runtime declaradas (patrón pino/zod del monorepo); otlp-http muerto removido del api
### T3 [DONE]: mixin de correlación en createLogger (trace_id + logging.googleapis.com/trace) + 4 tests

Verificación: otel-bootstrap 2 tests; logger 55; typecheck 5/5 servicios OK;
builds tsup 5/5 con dist/instrumentation.js; cloudtrace.agent ya en iam.tf:73.
Post-deploy manual obligatorio (§11): spans en Cloud Trace + log correlacionado.
