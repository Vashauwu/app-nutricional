import { DecimalInput, display } from './decimal';
import { IsoDate, IsoDateTime } from '../models/domain';

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` de una fecha local (evita corrimientos por zona horaria). */
export function toIsoDate(d: Date): IsoDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseIsoDate(value: IsoDate): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayIso = (): IsoDate => toIsoDate(new Date());

export function addDays(value: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(value);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((parseIsoDate(a).getTime() - parseIsoDate(b).getTime()) / 86_400_000);
}

/** Lunes de la semana de la fecha dada (semana lunes-domingo, §9.1). */
export function startOfWeek(value: IsoDate, weekStart: 'mon' | 'sun' = 'mon'): IsoDate {
  const d = parseIsoDate(value);
  const dow = d.getDay();
  const shift = weekStart === 'mon' ? (dow + 6) % 7 : dow;
  d.setDate(d.getDate() - shift);
  return toIsoDate(d);
}

/** DD/MM/AAAA (§19.1). */
export function formatDate(value: IsoDate | IsoDateTime | undefined | null): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateTime(value: IsoDateTime | undefined | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export const weekdayName = (value: IsoDate): string => WEEKDAYS[parseIsoDate(value).getDay()];
export const weekdayShort = (value: IsoDate): string => weekdayName(value).slice(0, 3);
export const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Martes 10 de noviembre". */
export function longDate(value: IsoDate): string {
  const d = parseIsoDate(value);
  return `${capitalize(WEEKDAYS[d.getDay()])} ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

export function shortDate(value: IsoDate): string {
  const d = parseIsoDate(value);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

export function relativeTime(value: IsoDateTime, now = Date.now()): string {
  const diff = now - new Date(value).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'justo ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days < 7) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return formatDate(value);
}

export function ageFrom(birthDate: IsoDate, now = new Date()): number {
  const b = parseIsoDate(birthDate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

export const initials = (first: string, last = ''): string =>
  `${first.trim()[0] ?? ''}${last.trim()[0] ?? ''}`.toUpperCase();

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Presentación de valores nutricionales: mínimo 2 decimales (§7.3), sin alterar el valor. */
export const fmt = (value: DecimalInput | undefined | null, places = 2): string =>
  value === undefined || value === null || value === '' ? '—' : display(value, places);

/** Versión compacta para tarjetas: 0 decimales para energía, 1 para macros. */
export function fmtCompact(value: DecimalInput | undefined | null, places = 0): string {
  if (value === undefined || value === null || value === '') return '—';
  return Number(display(value, 4)).toLocaleString('es-MX', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

export const uid = (prefix = ''): string =>
  `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

/** UUID v4: los elementos de un plan se identifican así también en el servidor. */
export const uuid = (): string => crypto.randomUUID();

export const normalizeText = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function downloadBlob(filename: string, content: string, mime: string): void {
  // BOM solo en texto: permite que Excel abra bien los acentos del CSV.
  const url = URL.createObjectURL(new Blob(mime.startsWith('text/') ? ['﻿', content] : [content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: (string | number | undefined | null)[][]): string {
  return rows
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}
