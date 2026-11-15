import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { Combobox, ComboOption } from './combobox';

@Component({
  imports: [Combobox],
  template: `<app-combobox label="Paciente" [options]="options" [allowAll]="true" [value]="value()" (valueChange)="value.set($event)" />`,
})
class Host {
  options: ComboOption[] = [
    { id: 'a', label: 'Ana Lucía Ramírez', hint: 'ana@demo.mx' },
    { id: 'c', label: 'Carlos Mendoza', hint: 'carlos@demo.mx' },
    { id: 'm', label: 'Mariana Torres', hint: 'mariana@demo.mx' },
  ];
  value = signal('');
}

function setup() {
  const f = TestBed.createComponent(Host);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const input = el.querySelector('input') as HTMLInputElement;
  const type = (v: string) => { input.value = v; input.dispatchEvent(new Event('input')); f.detectChanges(); };
  const options = () => [...el.querySelectorAll('[role=option]')].map((o) => o.textContent!.trim());
  return { f, el, input, type, options };
}

describe('Combobox', () => {
  it('filtra sin importar acentos ni mayúsculas', () => {
    const { type, options } = setup();
    type('LUCIA');
    expect(options()).toHaveLength(1);
    expect(options()[0]).toContain('Ana Lucía');
  });

  it('busca también en la pista (correo)', () => {
    const { type, options } = setup();
    type('carlos@');
    expect(options().some((o) => o.startsWith('Carlos'))).toBe(true);
  });

  it('elegir una opción emite su id y muestra su nombre', () => {
    const { f, type, el, input } = setup();
    type('mariana');
    (el.querySelectorAll('[role=option]')[0] as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.value()).toBe('m');
    expect(input.value).toBe('Mariana Torres');
  });

  it('«Todos» limpia la selección y Escape cierra la lista', () => {
    const { f, type, el, input } = setup();
    f.componentInstance.value.set('a');
    f.detectChanges();
    type('');
    (el.querySelector('[role=option]') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.value()).toBe('');
    input.focus();
    input.dispatchEvent(new Event('focus'));
    f.detectChanges();
    expect(el.querySelector('[role=listbox]')).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(el.querySelector('[role=listbox]')).toBeNull();
  });
});
