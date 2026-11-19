/* Tech-stack CSV import/export.

   Accepted input:
   - comma, semicolon (Excel in es-ES) or tab delimited, auto-detected
   - optional UTF-8 BOM, CRLF or LF line endings, RFC 4180 quoting
   - header row optional; when present, columns are matched by name in
     English or Spanish and may come in any order
   - without a header: technology, version, vendor, category                */

export interface StackCsvRow {
  technology: string;
  version?: string;
  vendor?: string;
  category?: string;
}

export interface StackCsvError {
  line: number;
  message: string;
}

export interface StackCsvResult {
  rows: StackCsvRow[];
  errors: StackCsvError[];
  duplicates: number;
}

export const CSV_MAX_BYTES = 1024 * 1024;
export const CSV_MAX_ROWS = 2000;
const FIELD_MAX = 100;

export const CSV_TEMPLATE =
  'technology,version,vendor,category\n' +
  'WordPress,6.4,Automattic,CMS\n' +
  'Apache HTTP Server,2.4,Apache,Web Server\n' +
  'PHP,8.2,,Runtime\n' +
  'FortiOS,7.2,Fortinet,Firewall\n' +
  'Microsoft Exchange Server,2019,Microsoft,Email\n';

type Field = keyof StackCsvRow;

const HEADER_ALIASES: Record<Field, string[]> = {
  technology: ['technology', 'tech', 'name', 'product', 'software', 'tecnologia', 'tecnología', 'producto', 'nombre'],
  version: ['version', 'versión', 'ver'],
  vendor: ['vendor', 'manufacturer', 'fabricante', 'proveedor', 'marca'],
  category: ['category', 'type', 'categoria', 'categoría', 'tipo'],
};

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function detectDelimiter(firstLine: string): string {
  const counts = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

/* RFC 4180 tokenizer. Returns records with the 1-based line each started on. */
export function parseCsv(text: string, delimiter: string): Array<{ line: number; cells: string[] }> {
  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(field);
      records.push({ line: recordLine, cells });
      cells = [];
      field = '';
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== '' || cells.length > 0) {
    cells.push(field);
    records.push({ line: recordLine, cells });
  }
  return records;
}

export function parseStackCsv(input: string): StackCsvResult {
  const errors: StackCsvError[] = [];
  if (Buffer.byteLength(input, 'utf8') > CSV_MAX_BYTES) {
    return { rows: [], errors: [{ line: 0, message: 'File is larger than 1 MB' }], duplicates: 0 };
  }

  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const records = parseCsv(text, detectDelimiter(firstLine))
    .filter((r) => r.cells.some((c) => c.trim() !== ''));

  if (records.length === 0) {
    return { rows: [], errors: [{ line: 0, message: 'The file is empty' }], duplicates: 0 };
  }

  /* Header detection: the first record is a header when any of its cells is
     a known column name. */
  let columnMap: Partial<Record<Field, number>> = { technology: 0, version: 1, vendor: 2, category: 3 };
  const headerCells = records[0].cells.map(normaliseHeader);
  const looksLikeHeader = headerCells.some((h) =>
    Object.values(HEADER_ALIASES).some((aliases) => aliases.map(normaliseHeader).includes(h))
  );

  let dataRecords = records;
  if (looksLikeHeader) {
    columnMap = {};
    (Object.keys(HEADER_ALIASES) as Field[]).forEach((field) => {
      const aliases = HEADER_ALIASES[field].map(normaliseHeader);
      const idx = headerCells.findIndex((h) => aliases.includes(h));
      if (idx !== -1) columnMap[field] = idx;
    });
    if (columnMap.technology === undefined) {
      return {
        rows: [],
        errors: [{ line: records[0].line, message: 'Header row has no "technology" column' }],
        duplicates: 0,
      };
    }
    dataRecords = records.slice(1);
  }

  if (dataRecords.length > CSV_MAX_ROWS) {
    return {
      rows: [],
      errors: [{ line: 0, message: `Too many rows (${dataRecords.length}); the limit is ${CSV_MAX_ROWS}` }],
      duplicates: 0,
    };
  }

  const rows: StackCsvRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const rec of dataRecords) {
    const get = (f: Field) => {
      const idx = columnMap[f];
      return idx === undefined ? '' : (rec.cells[idx] ?? '').trim();
    };
    const row: StackCsvRow = { technology: get('technology') };
    const version = get('version');
    const vendor = get('vendor');
    const category = get('category');
    if (version) row.version = version;
    if (vendor) row.vendor = vendor;
    if (category) row.category = category;

    if (!row.technology) {
      errors.push({ line: rec.line, message: 'Missing technology' });
      continue;
    }
    const tooLong = (Object.keys(row) as Field[]).find((k) => (row[k] ?? '').length > FIELD_MAX);
    if (tooLong) {
      errors.push({ line: rec.line, message: `"${tooLong}" is longer than ${FIELD_MAX} characters` });
      continue;
    }
    const key = stackKey(row);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    rows.push(row);
  }

  return { rows, errors, duplicates };
}

export function stackKey(row: { technology: string; version?: string | null }): string {
  return `${row.technology.trim().toLowerCase()}|${(row.version ?? '').trim().toLowerCase()}`;
}

/* Spreadsheet apps execute cells starting with = + - @ (and tab/CR) as
   formulas. Prefix them so an exported stack cannot carry a payload. */
function csvCell(value: string | null | undefined): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toStackCsv(rows: Array<{ technology: string; version?: string | null; vendor?: string | null; category?: string | null }>): string {
  const lines = ['technology,version,vendor,category'];
  for (const r of rows) {
    lines.push([r.technology, r.version, r.vendor, r.category].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}
