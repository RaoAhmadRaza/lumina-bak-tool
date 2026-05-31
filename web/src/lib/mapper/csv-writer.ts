import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Write an array of row objects as a CSV file.
 * All values are properly quoted to handle commas, quotes, and newlines.
 */
export function writeCsv(filePath: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    writeFileSync(filePath, '', 'utf-8');
    return;
  }

  const headers = Object.keys(rows[0]);
  const lines: string[] = [];

  // Header row
  lines.push(headers.map(quoteField).join(','));

  // Data rows
  for (const row of rows) {
    const values = headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return '""';
      return quoteField(String(val));
    });
    lines.push(values.join(','));
  }

  writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Quote a CSV field: wrap in double quotes, escape internal quotes.
 */
function quoteField(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Ensure the lumina output directory exists for a job.
 * Returns the path: {outputDir}/{jobId}/lumina/
 */
export function ensureLuminaDir(outputDir: string, jobId: string): string {
  const luminaDir = join(outputDir, jobId, 'lumina');
  if (!existsSync(luminaDir)) {
    mkdirSync(luminaDir, { recursive: true });
  }
  return luminaDir;
}

/**
 * Write mapped rows to a CSV in the lumina output directory.
 */
export function writeMappedCsv(
  outputDir: string,
  jobId: string,
  tableName: string,
  rows: Record<string, unknown>[]
): string {
  const luminaDir = ensureLuminaDir(outputDir, jobId);
  const filePath = join(luminaDir, `${tableName}.csv`);
  writeCsv(filePath, rows);
  return filePath;
}

/**
 * Write a JSON file to the lumina output directory.
 */
export function writeMappedJson(
  outputDir: string,
  jobId: string,
  fileName: string,
  data: unknown
): string {
  const luminaDir = ensureLuminaDir(outputDir, jobId);
  const filePath = join(luminaDir, fileName);
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════════
// SQL OUTPUT
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate a PostgreSQL INSERT statement for a batch of rows.
 */
export function generateInsertSQL(
  tableName: string,
  rows: Record<string, unknown>[]
): string {
  if (rows.length === 0) return `-- No data for ${tableName}\n`;

  const columns = Object.keys(rows[0]);
  const colList = columns.map((c) => `"${c}"`).join(', ');

  const valueLines: string[] = [];

  for (const row of rows) {
    const values = columns.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
      if (typeof val === 'number') return String(val);
      // String value: escape single quotes
      const str = String(val).replace(/'/g, "''");
      return `'${str}'`;
    });
    valueLines.push(`  (${values.join(', ')})`);
  }

  return `INSERT INTO "${tableName}" (${colList}) VALUES\n${valueLines.join(',\n')};\n`;
}

/**
 * Write a complete migration.sql file with all mapped tables in FK order.
 */
export function writeMigrationSQL(
  outputDir: string,
  jobId: string,
  tenantId: string,
  tableData: { tableName: string; rows: Record<string, unknown>[]; phase: string }[]
): string {
  const luminaDir = ensureLuminaDir(outputDir, jobId);
  const filePath = join(luminaDir, 'migration.sql');

  const parts: string[] = [
    '-- ═══════════════════════════════════════════════════════════════',
    '-- LUMINA POS Migration Script',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Source: CrystalBiz POS → Job ${jobId}`,
    `-- Tenant: ${tenantId}`,
    '-- ═══════════════════════════════════════════════════════════════',
    '',
    'BEGIN;',
    '',
  ];

  let currentPhase = '';
  for (const { tableName, rows, phase } of tableData) {
    if (phase !== currentPhase) {
      currentPhase = phase;
      parts.push(`-- ─── ${phase} ${'─'.repeat(50 - phase.length)}`);
      parts.push('');
    }
    parts.push(`-- ${tableName}: ${rows.length} rows`);
    parts.push(generateInsertSQL(tableName, rows));
    parts.push('');
  }

  parts.push('COMMIT;');
  parts.push('');

  writeFileSync(filePath, parts.join('\n'), 'utf-8');
  return filePath;
}
