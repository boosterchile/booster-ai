#!/usr/bin/env node
// Regenera legit-1000.json y adversarial-100.json para los threshold tests
// de T6 SEC-001 (false positive <=1%, false negative <=5%).
//
// Ejecutar:
//   node packages/logger/test/fixtures/generate.mjs
//
// Determinista: misma seed -> misma salida bit-a-bit.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers: tokens UUID-shape que NO disparan patterns Chile-phone
// (9-digit prefijo [2-9]) ni RUT modulo-11.
// ---------------------------------------------------------------------------

function hex(n, len) {
  const s = (n >>> 0).toString(16);
  return ('0'.repeat(len) + s).slice(-len);
}

// UUID-shape con prefijo `t` en el primer segmento y `a` en el quinto.
// Garantiza que ningun segmento queda all-digit (evita matches RUT/phone).
function uuid(i) {
  const a = `t${hex(i * 0x9e3779b1 + 1, 7)}`;
  const b = hex(i * 7 + 1, 4);
  const c = hex(i * 13 + 3, 4);
  const d = hex(i * 17 + 5, 4);
  const e = `a${hex(i * 19 + 11, 11)}`;
  return `${a}-${b}-${c}-${d}-${e}`;
}

// ---------------------------------------------------------------------------
// legit-1000.json: 25 templates x 40 iteraciones = 1000 entries.
// Todas SIN PII. Meta: false-positive rate <=1%.
// ---------------------------------------------------------------------------

const LEGIT_TEMPLATES = [
  (i) => ({ category: 'http_get', text: `GET /api/v1/trips/${uuid(i)} 200 ${20 + (i % 200)}ms` }),
  (i) => ({ category: 'http_post', text: `POST /api/v1/auth/refresh 401 ${10 + (i % 50)}ms` }),
  (i) => ({
    category: 'http_put',
    text: `PUT /api/v1/carriers/${uuid(i)}/offers ${i % 2 ? 200 : 422} ${15 + (i % 100)}ms`,
  }),
  (i) => ({
    category: 'http_delete',
    text: `DELETE /api/v1/sessions/${uuid(i)} 204 ${5 + (i % 30)}ms`,
  }),
  (i) => ({ category: 'http_health', text: `GET /health 200 ${1 + (i % 10)}ms` }),
  (i) => ({
    category: 'worker_state',
    text: `worker matching-engine-${i % 8} consumed lag=${i % 1000}ms`,
  }),
  (i) => ({
    category: 'pubsub_topic',
    text: `pubsub topic=trips.offer.dispatched attempt=${1 + (i % 3)} msgId=${uuid(i)}`,
  }),
  (i) => ({
    category: 'pubsub_telemetry',
    text: `pubsub topic=telemetry.points.codec8 attempt=${1 + (i % 3)} msgId=${uuid(i)}`,
  }),
  (i) => ({
    category: 'worker_uptime',
    text: `worker telemetry-processor-${i % 4} state=running uptime=${i * 60}s`,
  }),
  (i) => ({
    category: 'pubsub_ack',
    text: `pubsub ack msgId=${uuid(i)} latency=${10 + (i % 200)}ms`,
  }),
  (i) => ({
    category: 'db_select',
    text: `db.query SELECT table=viajes rows=${i % 50} took=${5 + (i % 100)}ms`,
  }),
  (i) => ({
    category: 'db_insert',
    text: `db.query INSERT table=usuarios rows=1 took=${3 + (i % 30)}ms`,
  }),
  (i) => ({
    category: 'db_update',
    text: `db.query UPDATE table=ofertas rows=${1 + (i % 10)} took=${8 + (i % 50)}ms`,
  }),
  (i) => ({
    category: 'cache_hit',
    text: `redis.cache.hit key=trip:${uuid(i)}:status ttl=${60 + (i % 600)}s`,
  }),
  (i) => ({
    category: 'cache_miss',
    text: `redis.cache.miss key=carrier:${uuid(i)}:idempotency ttl=${30 + (i % 300)}s`,
  }),
  (i) => ({
    category: 'metric_distribution',
    text: `metric matching.score.distribution value=${(i % 100) / 100}`,
  }),
  (i) => ({ category: 'metric_carbon', text: `metric carbon.calc.ms value=${20 + (i % 200)}` }),
  (i) => ({ category: 'metric_otel', text: `metric otel.span.count value=${i + 1}` }),
  (i) => ({
    category: 'config_load',
    text: `config loaded NODE_ENV=production version=v${i % 10}.${i % 20}.${i % 30}`,
  }),
  (i) => ({
    category: 'service_start',
    text: `service booster-ai-api started on port 8080 pid=${1000 + i}`,
  }),
  (i) => ({
    category: 'trip_in_transit',
    text: `trip ${uuid(i)} status=in_transit lane=Santiago-Valparaiso`,
  }),
  (i) => ({
    category: 'trip_delivered',
    text: `trip ${uuid(i)} status=delivered duration=${1 + (i % 8)}h${(i * 7) % 60}m`,
  }),
  (i) => ({
    category: 'offer_score',
    text: `offer ${uuid(i)} score=${(70 + (i % 30)) / 100} reason=base_distance`,
  }),
  (i) => ({
    category: 'error_timeout',
    text: `error TimeoutError at /app/src/handlers/${uuid(i).slice(0, 8)}.ts line=${20 + (i % 200)}`,
  }),
  (i) => ({
    category: 'warn_deprecated',
    text: `warn deprecated_api_call endpoint=/v0/${uuid(i)} client_id=${uuid(i).slice(0, 8)}`,
  }),
];

const legit = [];
for (let i = 0; i < 40; i++) {
  for (const tpl of LEGIT_TEMPLATES) {
    legit.push(tpl(i));
  }
}

if (legit.length !== 1000) {
  throw new Error(`legit fixture count mismatch: expected 1000, got ${legit.length}`);
}

// ---------------------------------------------------------------------------
// adversarial-100.json: 100 entries CON PII en formatos exoticos.
// Meta: false-negative rate <=5% (>=95 deben redactarse correctamente).
// Mix: 25 emails . 25 phones . 20 RUTs . 15 JWTs . 15 mixed/edge.
// ---------------------------------------------------------------------------

/** @typedef {{ category: string; text: string; expectedMarker: string }} Adversarial */

/** @type {Adversarial[]} */
const adversarial = [
  // Emails (25)
  {
    category: 'email_canonical',
    text: 'contacto: juan@empresa.cl',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_plus_tag',
    text: 'support+ticket123@booster-ai.com escalo',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_dot_local',
    text: 'first.last@dominio.cl aviso',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_subdomain',
    text: 'admin@mail.transportes.cl',
    expectedMarker: '[REDACTED:email]',
  },
  { category: 'email_short_local', text: 'n@x.cl', expectedMarker: '[REDACTED:email]' },
  {
    category: 'email_uppercase',
    text: 'JOHN@EXAMPLE.COM contactado',
    expectedMarker: '[REDACTED:email]',
  },
  { category: 'email_camel', text: 'JohnDoe@MailService.cl', expectedMarker: '[REDACTED:email]' },
  {
    category: 'email_hyphen_local',
    text: 'first-last@empresa-spa.cl',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_hyphen_domain',
    text: 'soporte@booster-ai.com',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_numeric_local',
    text: 'user1234@servicio.cl',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_url_query',
    text: 'GET /admin?email=admin@boosterchile.com 200',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_in_json',
    text: '{"email":"cliente@retail.cl","status":"active"}',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_csv',
    text: 'name,email,role\nAlice,alice@firma.cl,admin',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_multiline',
    text: 'From: notifications@booster.cl\nTo: dev@example.com',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_paren',
    text: 'reportado por (felipe@boosterchile.com) hoy',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_brackets',
    text: 'mail<contact@empresa.cl>',
    expectedMarker: '[REDACTED:email]',
  },
  { category: 'email_two_dots', text: 'a.b.c@x.y.z', expectedMarker: '[REDACTED:email]' },
  {
    category: 'email_long_tld',
    text: 'name@empresa.transports',
    expectedMarker: '[REDACTED:email]',
  },
  { category: 'email_eof', text: 'finalizado por user@dom.cl', expectedMarker: '[REDACTED:email]' },
  {
    category: 'email_bof',
    text: 'admin@portal.cl notificado a las 10:00',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_with_phone',
    text: 'contact juan@empresa.cl o +56912345678',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_payload',
    text: 'payload={"to":"buyer@market.cl","msg":"hola"}',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_log_kv',
    text: 'audit user_email=carlos@operador.cl action=login',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_stack',
    text: 'TypeError at notifyUser(test@firma.cl)',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'email_quoted',
    text: '"email": "lucia@booster-ai.com"',
    expectedMarker: '[REDACTED:email]',
  },

  // Phones Chile (25) - formatos exoticos per SC-H4.1 P1-R3-4
  {
    category: 'phone_e164',
    text: 'llamar +56912345678 urgente',
    expectedMarker: '[REDACTED:phone]',
  },
  { category: 'phone_spaces', text: 'tel: +56 9 1234 5678', expectedMarker: '[REDACTED:phone]' },
  { category: 'phone_dashes', text: 'cell +56-9-1234-5678', expectedMarker: '[REDACTED:phone]' },
  { category: 'phone_parens', text: 'movil +56 (9) 12345678', expectedMarker: '[REDACTED:phone]' },
  {
    category: 'phone_no_prefix',
    text: 'contacto 912345678 hoy',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'phone_no_plus',
    text: 'tel 56912345678 escribir',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'phone_landline_sg',
    text: 'oficina +56 2 2123 4567',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'phone_landline_no_prefix',
    text: 'fijo 221234567 horario',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'phone_mixed_seps',
    text: 'mobile +56-9 1234 5678',
    expectedMarker: '[REDACTED:phone]',
  },
  { category: 'phone_label', text: 'phoneNumber=+56912345678', expectedMarker: '[REDACTED:phone]' },
  {
    category: 'phone_json',
    text: '{"phone":"+56912345678","carrier":"movistar"}',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'phone_csv',
    text: 'name,phone\nMaria,+56912345678',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'phone_double_space',
    text: 'llamar  +56  9  1234  5678  ok',
    expectedMarker: '[REDACTED:phone]',
  },
  { category: 'phone_trailing', text: 'urgente 912345678', expectedMarker: '[REDACTED:phone]' },
  { category: 'phone_leading', text: '912345678 contactar', expectedMarker: '[REDACTED:phone]' },
  { category: 'phone_brackets', text: 'driver<+56912345678>', expectedMarker: '[REDACTED:phone]' },
  { category: 'phone_after_colon', text: 'Phone:+56912345678', expectedMarker: '[REDACTED:phone]' },
  {
    category: 'phone_before_period',
    text: 'whatsapp +56912345678.',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'phone_quoted',
    text: '"phone": "+56 9 8765 4321"',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'phone_with_country_label',
    text: 'CL +56 9 1234 5678 verificado',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'phone_paren_country',
    text: '(+56) 9 1234 5678',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'phone_log_kv',
    text: 'driver_phone=+56987654321 verified=true',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'phone_dispatch_template',
    text: 'Tu transportista llega: +56 9 8765 4321',
    expectedMarker: '[REDACTED:phone]',
  },
  { category: 'phone_e164_alt', text: '+56998765432', expectedMarker: '[REDACTED:phone]' },
  {
    category: 'phone_landline_paren',
    text: 'oficina (+56 2) 2123 4567',
    expectedMarker: '[REDACTED:phone]',
  },

  // RUTs Chile (20) - modulo-11 validos
  {
    category: 'rut_canonical',
    text: 'cliente 11111111-1 confirma',
    expectedMarker: '[REDACTED:rut]',
  },
  { category: 'rut_no_dash', text: 'cliente 111111111 confirma', expectedMarker: '[REDACTED:rut]' },
  {
    category: 'rut_dv_k_upper',
    text: 'rut 5000001-K verificado',
    expectedMarker: '[REDACTED:rut]',
  },
  {
    category: 'rut_dv_k_lower',
    text: 'rut 5000001-k verificado',
    expectedMarker: '[REDACTED:rut]',
  },
  {
    category: 'rut_dv_k_no_dash',
    text: 'rut 5000001K verificado',
    expectedMarker: '[REDACTED:rut]',
  },
  { category: 'rut_7_digit_body', text: 'rut 1234567-4', expectedMarker: '[REDACTED:rut]' },
  { category: 'rut_8_digit_body', text: 'rut 10000004-0', expectedMarker: '[REDACTED:rut]' },
  {
    category: 'rut_in_json',
    text: '{"rut":"11111111-1","name":"X"}',
    expectedMarker: '[REDACTED:rut]',
  },
  { category: 'rut_in_csv', text: 'rut,name\n11111111-1,Pedro', expectedMarker: '[REDACTED:rut]' },
  {
    category: 'rut_log_kv',
    text: 'shipper_rut=11111111-1 trip=abc',
    expectedMarker: '[REDACTED:rut]',
  },
  { category: 'rut_eof_period', text: 'verificar 11111111-1.', expectedMarker: '[REDACTED:rut]' },
  { category: 'rut_bof', text: '11111111-1 genero carga', expectedMarker: '[REDACTED:rut]' },
  { category: 'rut_with_label', text: 'RUT: 11111111-1', expectedMarker: '[REDACTED:rut]' },
  {
    category: 'rut_with_email',
    text: 'rut 11111111-1 email user@x.cl',
    expectedMarker: '[REDACTED:rut]',
  },
  { category: 'rut_paren', text: 'cliente (11111111-1)', expectedMarker: '[REDACTED:rut]' },
  { category: 'rut_brackets', text: '<rut>11111111-1</rut>', expectedMarker: '[REDACTED:rut]' },
  { category: 'rut_double_space', text: 'rut  11111111-1  ok', expectedMarker: '[REDACTED:rut]' },
  { category: 'rut_quoted', text: '"rut": "11111111-1"', expectedMarker: '[REDACTED:rut]' },
  { category: 'rut_after_colon', text: 'RUT:11111111-1', expectedMarker: '[REDACTED:rut]' },
  {
    category: 'rut_8_digit_no_dash',
    text: 'identificado 100000040',
    expectedMarker: '[REDACTED:rut]',
  },

  // JWTs (15)
  {
    category: 'jwt_authorization',
    text: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMSJ9.signaturepart',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_cookie',
    text: 'Set-Cookie: session=eyJhbGciOiJIUzI1NiJ9.eyJrZXkiOiJ2YWwifQ.abc',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_url_query',
    text: 'GET /resource?access_token=eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.zzz',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_json_payload',
    text: '{"token":"eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiJhYmMifQ.signatura"}',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_log_kv',
    text: 'authorization=eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjE3MDB9.firma trace=abc',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_pretty_print',
    text: 'token:\n  eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiJ4In0.signaturepart',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_inline',
    text: 'verificar eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYWRtaW4ifQ.sig en backend',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_leading',
    text: 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJib29zdGVyIn0.signaturepart al inicio',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_trailing',
    text: 'token eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.signaturepart',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_double',
    text: 'old=eyJhbGciOiJIUzI1NiJ9.eyJyZWZyZXNoIjp0cnVlfQ.a new=eyJhbGciOiJIUzI1NiJ9.eyJyZWZyZXNoIjpmYWxzZX0.b',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_quoted',
    text: '"authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig"',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_with_email',
    text: 'usuario user@x.cl token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_csv',
    text: 'user,token\nbob,eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2IifQ.sig',
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_curl_log',
    text: "curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig' /api",
    expectedMarker: '[REDACTED:jwt]',
  },
  {
    category: 'jwt_refresh_label',
    text: 'refresh_token: eyJhbGciOiJIUzI1NiJ9.eyJ0eXAiOiJyZWZyZXNoIn0.sig',
    expectedMarker: '[REDACTED:jwt]',
  },

  // Mixed / edge (15)
  {
    category: 'mixed_email_phone_rut',
    text: 'user juan@x.cl phone +56912345678 rut 11111111-1',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'mixed_email_phone_rut_phone_marker',
    text: 'user juan@x.cl phone +56912345678 rut 11111111-1',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'mixed_email_phone_rut_rut_marker',
    text: 'user juan@x.cl phone +56912345678 rut 11111111-1',
    expectedMarker: '[REDACTED:rut]',
  },
  {
    category: 'mixed_phone_email_inline',
    text: 'Tu conductor es Pedro (pedro@boosterchile.com, +56987654321)',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'mixed_phone_email_phone_marker',
    text: 'Tu conductor es Pedro (pedro@boosterchile.com, +56987654321)',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'mixed_audit_log',
    text: 'audit user.email=ana@firma.cl user.rut=11111111-1 ip=10.0.0.5',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'mixed_audit_log_rut_marker',
    text: 'audit user.email=ana@firma.cl user.rut=11111111-1 ip=10.0.0.5',
    expectedMarker: '[REDACTED:rut]',
  },
  {
    category: 'mixed_whatsapp_template',
    text: 'Hola Maria, tu carga esta confirmada. Conductor: Juan +56912345678',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'mixed_url_with_email',
    text: 'redirect https://app.cl/login?email=admin@empresa.cl&next=/',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'mixed_stack_with_email',
    text: 'Error: failed to send mail to recipient@x.cl from queue worker',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'mixed_phone_with_label_text',
    text: 'Contacta al transportista. Telefono +56-9-1234-5678. Gracias.',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'mixed_rut_inside_payload',
    text: 'POST /api/v1/users body={"rut":"11111111-1","email":"a@b.cl"}',
    expectedMarker: '[REDACTED:rut]',
  },
  {
    category: 'mixed_double_emails',
    text: 'CC: a@x.cl, b@y.cl',
    expectedMarker: '[REDACTED:email]',
  },
  {
    category: 'mixed_phone_in_template',
    text: 'WhatsApp dispatch: phone=+56912345678, lane=Santiago-Talca',
    expectedMarker: '[REDACTED:phone]',
  },
  {
    category: 'mixed_jwt_with_email_jwt_marker',
    text: 'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig user=carlos@firma.cl',
    expectedMarker: '[REDACTED:jwt]',
  },
];

if (adversarial.length !== 100) {
  throw new Error(`adversarial fixture count mismatch: expected 100, got ${adversarial.length}`);
}

// ---------------------------------------------------------------------------
// Write outputs.
// ---------------------------------------------------------------------------

writeFileSync(join(HERE, 'legit-1000.json'), `${JSON.stringify(legit, null, 2)}\n`);
writeFileSync(join(HERE, 'adversarial-100.json'), `${JSON.stringify(adversarial, null, 2)}\n`);
