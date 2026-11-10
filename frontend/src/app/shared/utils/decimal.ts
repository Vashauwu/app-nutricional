import Decimal from 'decimal.js';

/**
 * Política numérica del MVP (§7.3): los valores nutricionales nunca pasan por
 * `Number`. La API los serializa como strings y aquí se operan con decimal.js.
 *
 * - Sumas y multiplicaciones: exactas, sin redondeo intermedio.
 * - Divisiones: 16 decimales, Round Half Even.
 *
 * `precision` es en dígitos significativos; 60 deja margen para que sumas y
 * productos de valores con 16 decimales no se trunquen.
 */
export const NutriDecimal = Decimal.clone({
  precision: 60,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -40,
  toExpPos: 40,
});

export type DecimalInput = string | Decimal;

export const DIVISION_SCALE = 16;

export const dec = (value: DecimalInput): Decimal => new NutriDecimal(value);

export const add = (a: DecimalInput, b: DecimalInput): Decimal => dec(a).plus(b);

export const mul = (a: DecimalInput, b: DecimalInput): Decimal => dec(a).times(b);

export function div(a: DecimalInput, b: DecimalInput): Decimal {
  const divisor = dec(b);
  if (divisor.isZero()) {
    throw new RangeError('División entre cero en cálculo nutricional');
  }
  return dec(a).div(divisor).toDecimalPlaces(DIVISION_SCALE, Decimal.ROUND_HALF_EVEN);
}

export const sum = (values: readonly DecimalInput[]): Decimal =>
  values.reduce<Decimal>((acc, v) => acc.plus(v), dec('0'));

/** Solo para presentación; el valor almacenado no cambia. Mínimo dos decimales. */
export const display = (value: DecimalInput, places = 2): string =>
  dec(value).toFixed(Math.max(2, places), Decimal.ROUND_HALF_EVEN);
