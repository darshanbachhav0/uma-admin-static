/** CSV export used by the events, registrations and audit pages. */

/** Escape a single CSV cell, guarding against spreadsheet formula injection. */
function escapeCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Build CSV text from column definitions and rows.
 * @param {Array<{key:string, label:string, value?:(row:any)=>any}>} columns
 * @param {Array<object>} rows
 */
export function toCsv(columns, rows) {
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => escapeCell(c.value ? c.value(row) : row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

/** Trigger a client-side file download. */
export function downloadFile(filename, content, mime = 'text/csv;charset=utf-8;') {
  // BOM keeps accents readable when the file is opened in Excel.
  const blob = new Blob([mime.startsWith('text/csv') ? '﻿' : '', content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Timestamped export filename, e.g. `inscripciones-2026-09-22.csv`. */
export function exportFilename(prefix, extension = 'csv') {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `${prefix}-${stamp}.${extension}`;
}
