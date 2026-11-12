import { describe, expect, it } from 'vitest';
import { labStatus } from './domain';

describe('labStatus (semáforo de laboratorio)', () => {
  const glucose = { refMin: '70', refMax: '99' };

  it('verde dentro del rango, incluidos los límites', () => {
    expect(labStatus({ value: '85', ...glucose })).toMatchObject({ level: 'normal', tone: 'ok' });
    expect(labStatus({ value: '70', ...glucose }).level).toBe('normal');
    expect(labStatus({ value: '99', ...glucose }).level).toBe('normal');
  });

  it('amarillo hasta 10 % fuera del límite y rojo más allá', () => {
    expect(labStatus({ value: '105', ...glucose })).toMatchObject({ level: 'high', tone: 'warn', label: 'Alto' });
    expect(labStatus({ value: '126', ...glucose })).toMatchObject({ level: 'high', tone: 'crit' });
    expect(labStatus({ value: '66', ...glucose })).toMatchObject({ level: 'low', tone: 'warn', label: 'Bajo' });
    expect(labStatus({ value: '40', ...glucose })).toMatchObject({ level: 'low', tone: 'crit' });
  });

  it('con un solo límite compara solo contra ese', () => {
    expect(labStatus({ value: '150', refMax: '200' }).level).toBe('normal');
    expect(labStatus({ value: '230', refMax: '200' }).level).toBe('high');
    expect(labStatus({ value: '35', refMin: '40' }).level).toBe('low');
    expect(labStatus({ value: '55', refMin: '40' }).level).toBe('normal');
  });

  it('sin rango o con un valor no numérico no emite juicio', () => {
    expect(labStatus({ value: '5' })).toMatchObject({ level: 'unknown', tone: 'neutral' });
    expect(labStatus({ value: 'abc', ...glucose }).level).toBe('unknown');
  });
});
