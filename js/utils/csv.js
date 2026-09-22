/** CSV reading/writing used by the registrations export and the user importer. */

/**
 * Parse CSV text into rows. Supports quoted fields, escaped quotes and both
 * CRLF and LF line endings.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const input = String(text || '').replace(/^﻿/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') { inQuotes = true; continue; }
    if (char === ',' || char === ';') { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }

  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/**
 * Parse CSV text into objects keyed by a normalised header name.
 * @returns {{headers: string[], rows: Array<{index:number, values:object}>}}
 */
export function parseCsvObjects(text) {
  const raw = parseCsv(text);
  if (!raw.length) return { headers: [], rows: [] };

  const headers = raw[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
  const rows = raw.slice(1).map((cells, i) => {
    const values = {};
    headers.forEach((header, col) => { values[header] = (cells[col] ?? '').trim(); });
    // +2 so the number matches the line the administrator sees in a spreadsheet.
    return { index: i + 2, values };
  });
  return { headers, rows };
}

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

/** Read a File object as UTF-8 text. */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.readAsText(file, 'utf-8');
  });
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
