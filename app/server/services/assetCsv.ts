/* Assets CSV import/export. Same input rules as the stack CSV (services/csv.ts):
   comma, semicolon or tab delimited, optional BOM, RFC 4180 quoting, English
   or Spanish headers in any order. A header row is required here (assets have
   many optional columns, so position alone would be ambiguous).

   Columns: name (required), type, criticality, environment, hostname, ip,
   brand, model, owner, notes, technologies. Only the columns present in the
   file are written: a column left out keeps what the asset already has, a
   present but empty cell clears it. */

import { HttpError } from '../lib/http';
import { csvCell, detectDelimiter, normaliseHeader, parseCsv, repairExcelResave, splitAssetNames, CSV_MAX_BYTES } from './csv';
import { parseAssetType, parseCriticality, parseHostname, parseIps } from './assetValidation';
import type { AssetCriticality, AssetType } from '../db/schema';

export const ASSET_CSV_MAX_ROWS = 5000;

export type AssetField = 'name' | 'type' | 'criticality' | 'environment' | 'hostname' | 'ip' | 'brand' | 'model' | 'owner' | 'notes' | 'technologies';

const HEADER_ALIASES: Record<AssetField, string[]> = {
  name: ['name', 'asset', 'nombre', 'activo', 'equipo'],
  type: ['type', 'tipo', 'asset type', 'tipo de activo'],
  criticality: ['criticality', 'criticidad', 'priority', 'prioridad', 'importance', 'importancia'],
  environment: ['environment', 'env', 'entorno', 'ambiente'],
  hostname: ['hostname', 'host', 'fqdn', 'dns'],
  ip: ['ip', 'ips', 'ip address', 'ip addresses', 'direccion ip', 'direcciones ip', 'address'],
  brand: ['brand', 'make', 'manufacturer', 'vendor', 'marca', 'fabricante'],
  model: ['model', 'modelo'],
  owner: ['owner', 'responsible', 'responsable', 'propietario', 'dueno', 'dueño'],
  notes: ['notes', 'note', 'notas', 'nota', 'comments', 'comentarios', 'description', 'descripcion', 'descripción'],
  technologies: ['technologies', 'technology', 'stack', 'software', 'tecnologias', 'tecnologías', 'tecnologia', 'tecnología'],
};

const LIMITS: Partial<Record<AssetField, number>> = { name: 100, environment: 50, brand: 100, model: 100, owner: 100, notes: 1000 };

export interface AssetCsvRow {
  line: number;
  name: string;
  /* Only the fields whose column is in the file. */
  values: Partial<{
    type: AssetType;
    criticality: AssetCriticality;
    environment: string | null;
    hostname: string | null;
    ip: string | null;
    brand: string | null;
    model: string | null;
    owner: string | null;
    notes: string | null;
  }>;
  /* undefined = no technologies column; [] = clear the links. */
  technologies?: string[];
}

export interface AssetCsvResult {
  rows: AssetCsvRow[];
  errors: Array<{ line: number; message: string }>;
  duplicates: number;
  columns: AssetField[];
}

function fail(line: number, message: string): AssetCsvResult {
  return { rows: [], errors: [{ line, message }], duplicates: 0, columns: [] };
}

export function parseAssetCsv(input: string): AssetCsvResult {
  if (Buffer.byteLength(input, 'utf8') > CSV_MAX_BYTES) return fail(0, 'File is larger than 1 MB');
  const text = repairExcelResave(input.replace(/^\uFEFF/, '')).text;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const records = parseCsv(text, detectDelimiter(firstLine)).filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (records.length === 0) return fail(0, 'The file is empty');

  const header = records[0].cells.map(normaliseHeader);
  const columnMap: Partial<Record<AssetField, number>> = {};
  (Object.keys(HEADER_ALIASES) as AssetField[]).forEach((field) => {
    const aliases = HEADER_ALIASES[field].map(normaliseHeader);
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx !== -1) columnMap[field] = idx;
  });
  if (columnMap.name === undefined) return fail(records[0].line, 'The first row must be a header with a "name" column');

  const data = records.slice(1);
  if (data.length > ASSET_CSV_MAX_ROWS) return fail(0, `Too many rows (${data.length}); the limit is ${ASSET_CSV_MAX_ROWS}`);

  const columns = Object.keys(columnMap) as AssetField[];
  const rows: AssetCsvRow[] = [];
  const errors: AssetCsvResult['errors'] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const rec of data) {
    const get = (f: AssetField) => (columnMap[f] === undefined ? undefined : (rec.cells[columnMap[f]!] ?? '').trim());
    const name = get('name') ?? '';
    if (!name) { errors.push({ line: rec.line, message: 'Missing name' }); continue; }

    const tooLong = (Object.keys(LIMITS) as AssetField[]).find((f) => (get(f) ?? '').length > LIMITS[f]!);
    if (tooLong) { errors.push({ line: rec.line, message: `"${tooLong}" is longer than ${LIMITS[tooLong]} characters` }); continue; }

    const row: AssetCsvRow = { line: rec.line, name, values: {} };
    try {
      const type = get('type');
      if (type !== undefined) {
        const t = parseAssetType(type);
        if (!t) throw new HttpError(400, `Unknown asset type: ${type.slice(0, 40)}`);
        row.values.type = t;
      }
      const crit = get('criticality');
      if (crit !== undefined) {
        const c = parseCriticality(crit);
        if (!c) throw new HttpError(400, `Unknown criticality: ${crit.slice(0, 40)}`);
        row.values.criticality = c;
      }
      const hostname = get('hostname');
      if (hostname !== undefined) row.values.hostname = parseHostname(hostname);
      const ip = get('ip');
      if (ip !== undefined) row.values.ip = parseIps(ip);
      for (const f of ['environment', 'brand', 'model', 'owner', 'notes'] as const) {
        const v = get(f);
        if (v !== undefined) row.values[f] = v || null;
      }
      const tech = get('technologies');
      if (tech !== undefined) row.technologies = splitAssetNames(tech);
    } catch (err) {
      errors.push({ line: rec.line, message: err instanceof Error ? err.message : 'Invalid row' });
      continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    rows.push(row);
  }
  return { rows, errors, duplicates, columns };
}

export const ASSET_CSV_HEADER = 'name,type,criticality,environment,hostname,ip,brand,model,owner,notes,technologies';

export const ASSET_CSV_TEMPLATE =
  ASSET_CSV_HEADER + '\n' +
  'WEB01,server,high,prod,web01.example.com,10.0.2.11,Dell,PowerEdge R650,IT,Public website,Apache HTTP Server 2.4|PHP 8.2\n' +
  'FW-PERIMETRO,firewall,high,prod,fw01.example.local,"10.0.0.1;203.0.113.10",Fortinet,FortiGate 100F,Security,,FortiOS\n' +
  'LAPTOP-ANA,laptop,low,,,,Lenovo,ThinkPad T14,Ana,,Windows 11|Google Chrome\n';

export function toAssetCsv(rows: Array<{
  name: string; type: string; criticality: string; environment: string | null; hostname: string | null; ip: string | null;
  brand: string | null; model: string | null; owner: string | null; notes: string | null; technologies: string[];
}>): string {
  const lines = [ASSET_CSV_HEADER];
  for (const r of rows) {
    lines.push([r.name, r.type, r.criticality, r.environment, r.hostname, r.ip?.replace(/, /g, ';') ?? null, r.brand, r.model, r.owner, r.notes, r.technologies.join('|')]
      .map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}
