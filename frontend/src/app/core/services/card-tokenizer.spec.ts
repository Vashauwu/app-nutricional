import { describe, expect, it } from 'vitest';
import { cardErrors, luhnOk, parseExpiry } from './card-tokenizer';

describe('tarjeta', () => {
  it('valida el número con Luhn', () => {
    expect(luhnOk('4242424242424242')).toBe(true);
    expect(luhnOk('4242424242424241')).toBe(false);
    expect(luhnOk('1234')).toBe(false);
    expect(luhnOk('abcd424242424242')).toBe(false);
  });

  it('lee la vigencia y rechaza las vencidas', () => {
    const now = new Date(2026, 5, 15); // junio de 2026
    expect(parseExpiry('12/30', now)).toEqual({ month: 12, year: 2030 });
    expect(parseExpiry('6 / 2026', now)).toEqual({ month: 6, year: 2026 });
    expect(parseExpiry('05/26', now)).toBeNull();
    expect(parseExpiry('13/30', now)).toBeNull();
    expect(parseExpiry('hola', now)).toBeNull();
  });

  it('reporta cada campo inválido', () => {
    const now = new Date(2026, 5, 15);
    expect(cardErrors({ number: '4242 4242 4242 4242', name: 'Ana Pérez', expiry: '12/30', cvc: '123' }, now)).toEqual({});
    expect(Object.keys(cardErrors({ number: '4242', name: '', expiry: '01/20', cvc: '1' }, now)).sort()).toEqual(['cvc', 'expiry', 'name', 'number']);
  });
});
