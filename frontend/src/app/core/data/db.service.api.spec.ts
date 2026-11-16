import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DbService } from './db.service';

describe('DbService en modo API', () => {
  afterEach(() => { delete window.NUTRI_CONFIG; });

  it('no arranca con los datos de la demostración (marca, contacto, reglas ni pacientes)', () => {
    window.NUTRI_CONFIG = { apiMode: 'api' };
    const db = TestBed.inject(DbService).db();
    expect(db.patients).toHaveLength(0);
    expect(db.dishes).toHaveLength(0); // sus ids no son UUID: el servidor rechazaría un plan que los use (422)
    expect(db.settings.brand.tagline).toBe('');
    expect(db.settings.brand.phone).toBe('');
    expect(db.settings.brand.email).toBe('');
    expect(db.settings.brand.address).toBe('');
    expect(db.settings.brand.credentials).toBe('');
    expect(db.settings.brand.licenseNumber).toBe('');
    expect(db.settings.brand.primary).toBe('#4E344C');
    expect(db.settings.alerts.clinicalRules).toHaveLength(0);
  });
});
