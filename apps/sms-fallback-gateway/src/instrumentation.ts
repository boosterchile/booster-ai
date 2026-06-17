/**
 * Entry de instrumentación OTel — se carga vía `node --import` ANTES de
 * main.js (ver Dockerfile). NO importar desde main.ts (spec
 * feat-otel-bootstrap §6.1).
 *
 * `module.register(import-in-the-middle)` registra el loader hook que
 * permite patchear imports ESM nativos — sin él solo se instrumentan los
 * módulos CJS (require-in-the-middle del SDK); con bundles tsup ESM puros
 * eso dejaba huecos silenciosos (review 2026-06-11). El serviceName usa
 * el nombre Cloud Run (= SERVICE_NAME del logger y filtros TF) para que
 * trace↔log↔metric compartan identidad en consola.
 */
import { register } from 'node:module';
import { initOtel } from '@booster-ai/otel-bootstrap';

register('import-in-the-middle/hook.mjs', import.meta.url);

initOtel({
  serviceName: 'booster-ai-sms-fallback-gateway',
  serviceVersion: process.env.SERVICE_VERSION ?? '0.0.0-dev',
});
