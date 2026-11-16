import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DbService } from '../../core/data/db.service';
import { PlanEditorStore } from './plan-editor.store';

describe('PlanEditorStore (modo API)', () => {
  afterEach(() => { delete window.NUTRI_CONFIG; });

  it('detecta y quita platillos de demostración (id sin formato UUID) antes de enviarlos al servidor', () => {
    window.NUTRI_CONFIG = { apiMode: 'api' };
    TestBed.configureTestingModule({ providers: [PlanEditorStore] });
    const store = TestBed.inject(PlanEditorStore);
    const real = '0b9f6c1e-6a47-4c8e-9d5a-3f4b2a1c9e10';
    store.working.set({
      name: 'Plan', targets: { energy: '1800', protein: '90', carbs: '200', lipids: '60', equivalents: {}, version: 1 },
      days: [{ date: '2026-11-16', notes: '', slots: [{ id: 's1', name: 'Comida', items: [{ id: 'i1', dishId: 'd-yogurt', dishVersion: 1, servings: '1' }, { id: 'i2', dishId: real, dishVersion: 1, servings: '1' }] }] }],
    });
    expect(store.invalidItems().map((x) => x.id)).toEqual(['i1']);
    expect(TestBed.inject(DbService).db().dishes).toHaveLength(0);
  });
});
