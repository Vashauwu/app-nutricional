import { add, display, div, mul, sum } from './decimal';

describe('política decimal (§7.3)', () => {
  it('divide con 16 decimales', () => {
    expect(div('1', '3').toString()).toBe('0.3333333333333333');
    expect(div('2', '3').toString()).toBe('0.6666666666666667');
  });

  it('aplica Round Half Even en la frontera', () => {
    // 1/2^17 = 0.00000762939453125 (17 decimales, termina en 5): redondea al par.
    expect(div('1', '131072').toFixed(16)).toBe('0.0000076293945312');
    expect(div('3', '131072').toFixed(16)).toBe('0.0000228881835938');
  });

  it('no redondea sumas ni multiplicaciones', () => {
    expect(add('0.1', '0.2').toString()).toBe('0.3');
    expect(mul('0.3333333333333333', '0.3333333333333333').toString()).toBe(
      '0.11111111111111108888888888888889',
    );
    expect(sum(['0.1', '0.2', '0.3']).toString()).toBe('0.6');
  });

  it('rechaza la división entre cero', () => {
    expect(() => div('1', '0')).toThrow(RangeError);
  });

  it('muestra mínimo dos decimales sin alterar el valor', () => {
    expect(display('12')).toBe('12.00');
    expect(display('0.125')).toBe('0.12');
  });
});
