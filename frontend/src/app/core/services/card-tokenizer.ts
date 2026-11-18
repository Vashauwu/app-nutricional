import { Injectable } from '@angular/core';

/** Algoritmo de Luhn: detecta errores de captura del número de tarjeta. */
export function luhnOk(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** «MM/AA» o «MM/AAAA» → mes y año; null si no es válida o ya venció. */
export function parseExpiry(text: string, now = new Date()): { month: number; year: number } | null {
  const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(text.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return null;
  return { month, year };
}

export interface CardInput { number: string; name: string; expiry: string; cvc: string }

/** Errores por campo de la tarjeta capturada (vacío = válida). */
export function cardErrors(c: CardInput, now = new Date()): Partial<Record<keyof CardInput, string>> {
  const e: Partial<Record<keyof CardInput, string>> = {};
  if (!luhnOk(c.number.replace(/[\s-]/g, ''))) e.number = 'Revisa el número de la tarjeta.';
  if (c.name.trim().length < 2) e.name = 'Escribe el nombre como aparece en la tarjeta.';
  if (!parseExpiry(c.expiry, now)) e.expiry = 'Escribe una vigencia válida (MM/AA).';
  if (!/^\d{3,4}$/.test(c.cvc)) e.cvc = 'Escribe el código de seguridad (3 o 4 dígitos).';
  return e;
}

/**
 * Convierte la tarjeta capturada en un token que sí puede viajar al servidor. El número y el código de seguridad NUNCA se
 * envían a nuestra API. Con la pasarela simulada el token se arma aquí (solo los 4 últimos dígitos); con una pasarela real
 * lo produce su biblioteca en el navegador.
 */
@Injectable({ providedIn: 'root' })
export class CardTokenizer {
  tokenize(card: CardInput, provider: { provider: string }): Promise<string> {
    if (provider.provider === 'sim') {
      const digits = card.number.replace(/[\s-]/g, '');
      const exp = parseExpiry(card.expiry);
      return Promise.resolve(`sim:${digits.slice(-4)}:${exp ? String(exp.month).padStart(2, '0') + '/' + exp.year : '12/2030'}`);
    }
    return Promise.reject(new Error('Este proveedor de pago aún no está disponible.'));
  }
}
