/* Tech-stack CSV import/export.

   Accepted input:
   - comma, semicolon (Excel in es-ES) or tab delimited, auto-detected
   - optional UTF-8 BOM, CRLF or LF line endings, RFC 4180 quoting
   - header row optional; when present, columns are matched by name in
     English or Spanish and may come in any order
   - without a header: technology, version, vendor, category, assets
   - assets: asset names separated by | ; or , (created if missing)         */

export interface StackCsvRow {
  technology: string;
  version?: string;
  vendor?: string;
  category?: string;
  assets?: string[];
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
const MAX_ASSETS_PER_ROW = 50;

export const CSV_TEMPLATE =
  'technology,version,vendor,category,assets\n' +
  'WordPress,6.4,Automattic,CMS,WEB01\n' +
  'Apache HTTP Server,2.4,Apache,Web Server,WEB01|WEB02\n' +
  'PHP,8.2,,Runtime,WEB01|WEB02\n' +
  'FortiOS,7.2,Fortinet,Firewall,FW-PERIMETRO\n' +
  'Microsoft Exchange Server,2019,Microsoft,Email,\n';

type TextField = 'technology' | 'version' | 'vendor' | 'category';
type Field = TextField | 'assets';

const HEADER_ALIASES: Record<Field, string[]> = {
  technology: ['technology', 'tech', 'name', 'product', 'software', 'tecnologia', 'tecnología', 'producto', 'nombre'],
  version: ['version', 'versión', 'ver'],
  vendor: ['vendor', 'manufacturer', 'fabricante', 'proveedor', 'marca'],
  category: ['category', 'type', 'categoria', 'categoría', 'tipo'],
  assets: ['assets', 'asset', 'activos', 'activo', 'hosts', 'equipos'],
};

/* Asset names in one cell: | ; or , separated, trimmed, de-duplicated
   (case-insensitive, first spelling wins). */
export function splitAssetNames(cell: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of cell.split(/[|;,]/)) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

export function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function detectDelimiter(firstLine: string): string {
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

/* A comma CSV opened and saved again by Excel in a locale that uses ";"
   (Spanish, French…) comes back mangled: Excel split each row at the ";"
   inside cells, wrapped the pieces in quotes and padded the row with ";".
   Re-reading such a file with ";" and joining the pieces back with ";"
   restores the original comma CSV. Only applied when the header row has
   commas and ends with the ";" padding, which a real CSV never does. */
export function repairExcelResave(text: string): { text: string; repaired: boolean } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines[0] ?? '';
  const padded = lines.filter((l) => /;\s*$/.test(l)).length;
  if (!header.includes(',') || !/;\s*$/.test(header) || padded < Math.ceil(lines.length / 2)) {
    return { text, repaired: false };
  }
  const rebuilt = parseCsv(text, ';')
    .map((r) => r.cells.join(';').replace(/;+\s*$/, ''))
    .filter((l) => l.trim() !== '');
  return { text: rebuilt.join('\n') + '\n', repaired: true };
}

export function parseStackCsv(input: string): StackCsvResult {
  const errors: StackCsvError[] = [];
  if (Buffer.byteLength(input, 'utf8') > CSV_MAX_BYTES) {
    return { rows: [], errors: [{ line: 0, message: 'File is larger than 1 MB' }], duplicates: 0 };
  }

  const text = repairExcelResave(input.replace(/^\uFEFF/, '')).text;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const records = parseCsv(text, detectDelimiter(firstLine))
    .filter((r) => r.cells.some((c) => c.trim() !== ''));

  if (records.length === 0) {
    return { rows: [], errors: [{ line: 0, message: 'The file is empty' }], duplicates: 0 };
  }

  /* Header detection: the first record is a header when any of its cells is
     a known column name. */
  let columnMap: Partial<Record<Field, number>> = { technology: 0, version: 1, vendor: 2, category: 3, assets: 4 };
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
  const seen = new Map<string, StackCsvRow>();
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
    const assetNames = splitAssetNames(get('assets'));

    if (!row.technology) {
      errors.push({ line: rec.line, message: 'Missing technology' });
      continue;
    }
    const tooLong = (['technology', 'version', 'vendor', 'category'] as TextField[]).find((k) => (row[k] ?? '').length > FIELD_MAX);
    if (tooLong) {
      errors.push({ line: rec.line, message: `"${tooLong}" is longer than ${FIELD_MAX} characters` });
      continue;
    }
    if (assetNames.some((n) => n.length > FIELD_MAX)) {
      errors.push({ line: rec.line, message: `An asset name is longer than ${FIELD_MAX} characters` });
      continue;
    }
    if (assetNames.length > MAX_ASSETS_PER_ROW) {
      errors.push({ line: rec.line, message: `More than ${MAX_ASSETS_PER_ROW} assets in one row` });
      continue;
    }
    const key = stackKey(row);
    const first = seen.get(key);
    if (first) {
      /* Same technology and version again: its assets join the first row. */
      if (assetNames.length) first.assets = splitAssetNames([...(first.assets ?? []), ...assetNames].join('|'));
      duplicates++;
      continue;
    }
    if (assetNames.length) row.assets = assetNames;
    seen.set(key, row);
    rows.push(row);
  }

  return { rows, errors, duplicates };
}

export function stackKey(row: { technology: string; version?: string | null }): string {
  return `${row.technology.trim().toLowerCase()}|${(row.version ?? '').trim().toLowerCase()}`;
}

/* Spreadsheet apps execute cells starting with = + - @ (and tab/CR) as
   formulas. Prefix them so an exported stack cannot carry a payload. */
export function csvCell(value: string | null | undefined): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toStackCsv(rows: Array<{ technology: string; version?: string | null; vendor?: string | null; category?: string | null; assets?: string[] }>): string {
  const lines = ['technology,version,vendor,category,assets'];
  for (const r of rows) {
    lines.push([r.technology, r.version, r.vendor, r.category, (r.assets ?? []).join('|')].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}
