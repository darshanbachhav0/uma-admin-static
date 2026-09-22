/**
 * Formatting helpers.
 *
 * All date handling is explicit about local vs. UTC: event dates are stored as
 * epoch milliseconds and are always presented and edited in the browser's local
 * timezone (America/Lima for UMA staff).
 */

const LOCALE = 'es-PE';

const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit' });
const numberFmt = new Intl.NumberFormat(LOCALE);

export const EM_DASH = '—';

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(Number(value) || value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value) {
  const date = toDate(value);
  return date ? dateFmt.format(date) : EM_DASH;
}

export function formatDateTime(value) {
  const date = toDate(value);
  return date ? dateTimeFmt.format(date) : EM_DASH;
}

export function formatTime(value) {
  const date = toDate(value);
  return date ? timeFmt.format(date) : EM_DASH;
}

export function formatMonth(value) {
  const date = toDate(value);
  return date ? monthFmt.format(date) : EM_DASH;
}

export function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? numberFmt.format(n) : EM_DASH;
}

/** Relative time in Spanish, falling back to an absolute date beyond a month. */
export function formatRelative(value) {
  const date = toDate(value);
  if (!date) return EM_DASH;
  const diffMs = date.getTime() - Date.now();
  const absMin = Math.abs(diffMs) / 60000;

  if (absMin < 1) return 'hace unos segundos';
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  if (absMin < 60) return rtf.format(Math.round(diffMs / 60000), 'minute');
  if (absMin < 60 * 24) return rtf.format(Math.round(diffMs / 3600000), 'hour');
  if (absMin < 60 * 24 * 30) return rtf.format(Math.round(diffMs / 86400000), 'day');
  return formatDate(date);
}

/** `YYYY-MM-DD` in local time (never UTC — avoids off-by-one-day bugs). */
export function toDateInputValue(value) {
  const date = toDate(value);
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `HH:MM` in local time. */
export function toTimeInputValue(value) {
  const date = toDate(value);
  if (!date) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Combine a `YYYY-MM-DD` date input and an optional `HH:MM` time input into an
 * epoch timestamp, interpreted in the browser's local timezone.
 * @returns {number|null} null when the input is absent or invalid.
 */
export function fromDateTimeInputs(dateValue, timeValue) {
  if (!dateValue) return null;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  if (!dateMatch) return null;
  const [, ys, ms, ds] = dateMatch;

  let hours = 0;
  let minutes = 0;
  if (timeValue) {
    const timeMatch = /^(\d{1,2}):(\d{2})/.exec(timeValue.trim());
    if (!timeMatch) return null;
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
    if (hours > 23 || minutes > 59) return null;
  }

  const year = Number(ys);
  const month = Number(ms) - 1;
  const day = Number(ds);
  const date = new Date(year, month, day, hours, minutes, 0, 0);
  // Reject impossible calendar dates such as 2026-02-31 (which JS rolls over).
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date.getTime();
}

/** First millisecond of the month containing `value` (local time). */
export function startOfMonth(value = Date.now()) {
  const date = toDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

export function startOfDay(value = Date.now()) {
  const date = toDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function addMonths(value, count) {
  const date = toDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth() + count, 1).getTime();
}

/** Initials for an avatar, e.g. "coordinacion@uma.edu.pe" -> "CO". */
export function initials(value) {
  const text = String(value || '').trim();
  if (!text) return '?';
  const local = text.includes('@') ? text.split('@')[0] : text;
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).slice(0, 2);
  return local.slice(0, 2);
}

/** Mask a national ID, keeping the last 3 digits: 12345678 -> *****678 */
export function maskDni(value) {
  const text = String(value || '').trim();
  if (!text) return EM_DASH;
  if (text.length <= 3) return '*'.repeat(text.length);
  return '*'.repeat(text.length - 3) + text.slice(-3);
}

export function truncate(value, max = 60) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Plural helper: pluralize(1, 'evento', 'eventos') -> "1 evento" */
export function pluralize(count, singular, plural) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}
