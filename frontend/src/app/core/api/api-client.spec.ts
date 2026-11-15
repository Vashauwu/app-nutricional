import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ApiClient } from './api-client';

describe('ApiClient: GET duplicados', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  it('dos consultas iguales a la vez comparten una sola petición', () => {
    const got: unknown[] = [];
    api.get('/dishes', { q: 'pollo' }).subscribe((r) => got.push(r));
    api.get('/dishes', { q: 'pollo' }).subscribe((r) => got.push(r));
    const reqs = http.match((r) => r.url === '/api/v1/dishes');
    expect(reqs.length).toBe(1);
    reqs[0].flush({ ok: true });
    expect(got).toEqual([{ ok: true }, { ok: true }]);
  });

  it('parámetros distintos no se mezclan', () => {
    api.get('/dishes', { q: 'pollo' }).subscribe();
    api.get('/dishes', { q: 'arroz' }).subscribe();
    expect(http.match((r) => r.url === '/api/v1/dishes').length).toBe(2);
  });

  it('una vez terminada, la siguiente consulta vuelve al servidor (sin datos viejos)', () => {
    api.get('/settings').subscribe();
    http.expectOne('/api/v1/settings').flush({ v: 1 });
    let second: unknown;
    api.get('/settings').subscribe((r) => (second = r));
    http.expectOne('/api/v1/settings').flush({ v: 2 });
    expect(second).toEqual({ v: 2 });
  });

  it('un error no se queda atascado: se puede reintentar', () => {
    let failed = false;
    api.get('/plans').subscribe({ error: () => (failed = true) });
    http.expectOne('/api/v1/plans').flush({}, { status: 500, statusText: 'x' });
    expect(failed).toBe(true);
    api.get('/plans').subscribe();
    http.expectOne('/api/v1/plans').flush([]);
  });

  it('las escrituras nunca se comparten', () => {
    api.post('/plans', { a: 1 }).subscribe();
    api.post('/plans', { a: 1 }).subscribe();
    expect(http.match((r) => r.url === '/api/v1/plans').length).toBe(2);
  });
});
