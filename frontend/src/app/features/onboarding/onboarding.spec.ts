import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DbService } from '../../core/data/db.service';
import { Onboarding } from './onboarding';

describe('Onboarding (inicio guiado)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }));
  });

  it('avanza al paso 2 solo con nombre, y al terminar marca la cuenta como iniciada y guarda la marca', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const data = TestBed.inject(DbService);
    data.mutate((d) => { d.settings.profile.onboardingDone = false; d.settings.profile.fullName = ''; });
    const f = TestBed.createComponent(Onboarding);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Paso 1 de 2');

    (el.querySelector('.actions .lp-btn, .actions button:last-of-type') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.textContent).toContain('Paso 1 de 2');
    expect(el.textContent).toContain('Escribe tu nombre.');

    const name = el.querySelector('#ob-name') as HTMLInputElement;
    name.value = 'Valeria Montes'; name.dispatchEvent(new Event('input'));
    (el.querySelector('.actions button:last-of-type') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.textContent).toContain('Paso 2 de 2');
    expect(el.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('2');

    const biz = el.querySelector('#ob-biz') as HTMLInputElement;
    biz.value = 'Nutrición Sol'; biz.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(el.querySelector('.doc')?.textContent).toContain('Nutrición Sol');
    (el.querySelector('.actions button:last-of-type') as HTMLButtonElement).click();
    await f.whenStable();
    const s = data.db().settings;
    expect(s.profile.onboardingDone).toBe(true);
    expect(s.profile.fullName).toBe('Valeria Montes');
    expect(s.brand.businessName).toBe('Nutrición Sol');
  });
});
