import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { CsvRow } from './types';

/**
 * Parse a CSV string with proper double-quote handling.
 * CrystalBiz CSVs use: "col1","col2","col3" with double-quoted fields.
 * We do NOT use external libs to keep deps minimal.
 */
export function parseCsv(content: string): CsvRow[] {
  const lines = splitCsvLines(content);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    const values = parseCsvLine(line);
    const row: CsvRow = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = j < values.length ? values[j] : '';
    }

    rows.push(row);
  }

  return rows;
}

/**
 * Split CSV content into lines, respecting quoted fields that contain newlines.
 */
function splitCsvLines(content: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && content[i + 1] === '\n') i++; // skip \r\n
      if (current.trim()) lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) lines.push(current);
  return lines;
}

/**
 * Parse a single CSV line into field values.
 * Handles double-quoted fields: "value" → value, "" → " (escaped quote).
 */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let i = 0;

  while (i < line.length) {
    // Skip whitespace before field
    while (i < line.length && line[i] === ' ') i++;

    if (i >= line.length) break;

    if (line[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let value = '';
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            // Escaped quote ""
            value += '"';
            i += 2;
          } else {
            // End of quoted field
            i++; // skip closing quote
            break;
          }
        } else {
          value += line[i];
          i++;
        }
      }
      values.push(value);
      // Skip comma after quoted field
      if (i < line.length && line[i] === ',') i++;
    } else {
      // Unquoted field
      let value = '';
      while (i < line.length && line[i] !== ',') {
        value += line[i];
        i++;
      }
      values.push(value.trim());
      if (i < line.length && line[i] === ',') i++;
    }
  }

  return values;
}

/**
 * Read a CSV file from the extracted output directory.
 * Returns the parsed rows, or null if file doesn't exist.
 */
export function readExtractedCsv(outputDir: string, jobId: string, tableName: string): CsvRow[] | null {
  const filePath = join(outputDir, jobId, `${tableName}.csv`);

  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, 'utf-8');
  return parseCsv(content);
}

/**
 * List all CSV files in an extracted job directory.
 * Returns filenames without the .csv extension.
 */
export function listExtractedTables(outputDir: string, jobId: string): string[] {
  const dir = join(outputDir, jobId);

  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.csv') && !f.startsWith('_'))
    .map((f) => f.replace('.csv', ''));
}

/**
 * Read the _schema.json from an extracted job directory.
 */
export function readExtractedSchema(outputDir: string, jobId: string): Record<string, unknown>[] | null {
  const filePath = join(outputDir, jobId, '_schema.json');

  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}
