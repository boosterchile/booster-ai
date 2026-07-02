import { describe, expect, it } from 'vitest';
import { createConnectionGuard, createSlidingWindowLimiter } from '../src/rate-limiter.js';

describe('createConnectionGuard — cap de conexiones concurrentes', () => {
  it('admite hasta maxConcurrent y rechaza el siguiente', () => {
    const guard = createConnectionGuard(2);
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.tryAcquire()).toBe(false); // 3ra excede el cap
    expect(guard.active).toBe(2);
  });

  it('release libera un slot para una nueva conexión', () => {
    const guard = createConnectionGuard(1);
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.tryAcquire()).toBe(false);
    guard.release();
    expect(guard.active).toBe(0);
    expect(guard.tryAcquire()).toBe(true);
  });

  it('release nunca baja active por debajo de 0 (doble release defensivo)', () => {
    const guard = createConnectionGuard(1);
    guard.tryAcquire();
    guard.release();
    guard.release();
    expect(guard.active).toBe(0);
  });
});

describe('createSlidingWindowLimiter — rate limit de enrollment', () => {
  it('admite maxEvents dentro de la ventana y rechaza el excedente', () => {
    const nowMs = 1000;
    const limiter = createSlidingWindowLimiter({ maxEvents: 3, windowMs: 1000, now: () => nowMs });
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false); // 4to en la misma ventana
  });

  it('vuelve a admitir cuando los eventos viejos salen de la ventana', () => {
    let nowMs = 1000;
    const limiter = createSlidingWindowLimiter({ maxEvents: 2, windowMs: 1000, now: () => nowMs });
    expect(limiter.tryConsume()).toBe(true); // t=1000
    expect(limiter.tryConsume()).toBe(true); // t=1000
    expect(limiter.tryConsume()).toBe(false); // lleno
    nowMs = 2001; // los dos eventos de t=1000 ya están fuera de la ventana [1001..2001]
    expect(limiter.tryConsume()).toBe(true);
  });

  it('la ventana es deslizante, no fija: un evento viejo libera cupo parcial', () => {
    let nowMs = 0;
    const limiter = createSlidingWindowLimiter({ maxEvents: 1, windowMs: 100, now: () => nowMs });
    expect(limiter.tryConsume()).toBe(true); // t=0
    nowMs = 50;
    expect(limiter.tryConsume()).toBe(false); // t=50, el de t=0 sigue dentro [−50..50]... no, dentro de (−50,50]? está en ventana
    nowMs = 101;
    expect(limiter.tryConsume()).toBe(true); // t=101, el de t=0 salió de (1,101]
  });
});
