import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { merge, startWith, switchMap } from 'rxjs';

const DEFAULTS: Record<string, string | ((e: ValidationErrors) => string)> = {
  required: 'Este campo es obligatorio.',
  email: 'Escribe un correo válido, por ejemplo nombre@dominio.mx.',
  minlength: (e) => `Escribe al menos ${e['requiredLength']} caracteres.`,
  maxlength: (e) => `Máximo ${e['requiredLength']} caracteres.`,
  min: (e) => `El valor mínimo es ${e['min']}.`,
  max: (e) => `El valor máximo es ${e['max']}.`,
  decimal: 'Escribe un número válido (usa punto decimal).',
  positive: 'El valor debe ser mayor a cero.',
  mismatch: 'Los campos no coinciden.',
  weak: 'Usa al menos 8 caracteres, con una letra y un número.',
  adult: 'El MVP atiende solo a personas adultas (18 años o más).',
  futureDate: 'La fecha no puede ser futura.',
  dateOrder: 'La fecha de término debe ser posterior al inicio.',
  taken: 'Este valor ya está registrado.',
  pattern: 'El formato no es válido.',
};

/** Muestra el primer error del control cuando ya fue tocado (§20.1: mensajes claros). */
@Component({
  selector: 'app-field-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (message(); as m) { <p class="error" [id]="id()" role="alert">{{ m }}</p> }`,
})
export class FieldError {
  readonly control = input.required<AbstractControl>();
  readonly id = input('');
  readonly messages = input<Record<string, string>>({});

  /** Los controles reactivos no son señales: se escuchan sus eventos (touched, valor, estado). */
  private readonly tick = toSignal(
    toObservable(this.control).pipe(switchMap((c) => merge(c.events, c.statusChanges).pipe(startWith(null)))),
    { initialValue: null },
  );

  protected readonly message = computed(() => {
    this.tick();
    const c = this.control();
    if (!c.touched && !c.dirty) return null;
    if (!c.errors) return null;
    const key = Object.keys(c.errors)[0];
    const custom = this.messages()[key];
    if (custom) return custom;
    const d = DEFAULTS[key];
    return typeof d === 'function' ? d(c.errors[key] as ValidationErrors) : (d ?? 'El valor no es válido.');
  });
}

export const decimalValidator: ValidatorFn = (c) => {
  const v = String(c.value ?? '').trim();
  if (!v) return null;
  return /^-?\d+(\.\d+)?$/.test(v) ? null : { decimal: true };
};

export const positiveDecimalValidator: ValidatorFn = (c) => {
  const v = String(c.value ?? '').trim();
  if (!v) return null;
  if (!/^\d+(\.\d+)?$/.test(v)) return { decimal: true };
  return Number(v) > 0 ? null : { positive: true };
};

export const strongPassword: ValidatorFn = (c) => {
  const v = String(c.value ?? '');
  if (!v) return null;
  return v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v) ? null : { weak: true };
};

export const matchField = (other: string): ValidatorFn => (c) => {
  const peer = c.parent?.get(other);
  return peer && c.value !== peer.value ? { mismatch: true } : null;
};

export const adultValidator: ValidatorFn = (c) => {
  const v = String(c.value ?? '');
  if (!v) return null;
  const b = new Date(v);
  if (Number.isNaN(b.getTime())) return { pattern: true };
  const now = new Date();
  if (b > now) return { futureDate: true };
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age >= 18 ? null : { adult: true };
};
