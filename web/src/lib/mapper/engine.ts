// ─── Mapping Engine ──────────────────────────────────────────────────
// Reads extracted CSVs, applies a MappingConfig, writes mapped output.

import type {
  MappingConfig,
  MappingContext,
  MappingResult,
  TableMapping,
  TableMappingResult,
  MappingWarning,
  CsvRow,
} from './types';
import { readExtractedCsv } from './csv-reader';
import { writeMappedCsv, writeMappedJson, writeMigrationSQL } from './csv-writer';
import { createIdMap, generateUUID, registerMapping, lookupId, serializeIdMap } from './id-map';
import { normalizeBrand, deduplicateBrands, slugify } from './transforms';

/**
 * Run the full mapping process for a given config.
 */
export async function runMapping(
  config: MappingConfig,
  outputDir: string,
  jobId: string,
  options: {
    tenantId?: string;
    format?: 'csv' | 'sql' | 'both';
  } = {}
): Promise<MappingResult> {
  const tenantId = options.tenantId || generateUUID();
  const format = options.format || 'both';
  const idMap = createIdMap();

  // Create the branch first — we need branchId for context
  // It will be populated during Phase 1
  const branchId = generateUUID();

  const context: MappingContext = {
    idMap,
    tenantId,
    branchId,
    migrationTimestamp: new Date().toISOString(),
    jobId,
  };

  const result: MappingResult = {
    jobId,
    detectedFormat: config.formatName,
    tenantId,
    branchId,
    phases: [],
    totalInputRows: 0,
    totalOutputRows: 0,
    warnings: [],
    outputDir: `${outputDir}/${jobId}/lumina`,
  };

  // Collect all SQL data for final output
  const sqlData: { tableName: string; rows: Record<string, unknown>[]; phase: string }[] = [];

  // ─── Execute each phase in order ───
  for (const phase of config.phases) {
    const phaseResult = {
      name: phase.name,
      tables: [] as TableMappingResult[],
    };

    for (const tableMapping of phase.tables) {
      const tableResult = processTable(tableMapping, outputDir, jobId, context, format, sqlData, phase.name);

      phaseResult.tables.push(tableResult);
      result.totalInputRows += tableResult.inputRows;
      result.totalOutputRows += tableResult.outputRows;
      result.warnings.push(...tableResult.warnings);
    }

    result.phases.push(phaseResult);
  }

  // ─── Write ID map ───
  writeMappedJson(outputDir, jobId, '_id_map.json', serializeIdMap(idMap));

  // ─── Write migration report ───
  const report = buildMigrationReport(result);
  writeMappedJson(outputDir, jobId, '_migration_report.json', report);

  // ─── Write SQL file if requested ───
  if (format === 'sql' || format === 'both') {
    writeMigrationSQL(outputDir, jobId, tenantId, sqlData);
  }

  return result;
}

/**
 * Process a single table mapping: read source CSV → apply transforms → write output.
 */
function processTable(
  mapping: TableMapping,
  outputDir: string,
  jobId: string,
  context: MappingContext,
  format: string,
  sqlData: { tableName: string; rows: Record<string, unknown>[]; phase: string }[],
  phaseName: string
): TableMappingResult {
  const warnings: MappingWarning[] = [];

  // ─── Handle special "brands" deduplication ───
  if (mapping.targetTable === 'brands' && mapping.preProcess) {
    return processBrandsSpecial(mapping, outputDir, jobId, context, format, sqlData, phaseName);
  }

  // ─── Read source CSV ───
  const sourceRows = readExtractedCsv(outputDir, jobId, mapping.sourceTable);

  if (!sourceRows) {
    warnings.push({
      type: 'MISSING_SOURCE',
      message: `Source table ${mapping.sourceTable}.csv not found — skipping`,
    });
    return {
      sourceTable: mapping.sourceTable,
      targetTable: mapping.targetTable,
      inputRows: 0,
      outputRows: 0,
      skippedRows: 0,
      warnings,
    };
  }

  // ─── Apply filter if defined ───
  let filteredRows = sourceRows;
  if (mapping.filter) {
    filteredRows = sourceRows.filter(mapping.filter);
  }

  // ─── Apply preProcess if defined ───
  if (mapping.preProcess) {
    filteredRows = mapping.preProcess(filteredRows);
  }

  // ─── Map each row ───
  const mappedRows: Record<string, unknown>[] = [];
  let skippedRows = 0;

  for (const sourceRow of filteredRows) {
    try {
      const mappedRow = mapRow(sourceRow, mapping, context);
      if (mappedRow) {
        mappedRows.push(mappedRow);
      } else {
        skippedRows++;
      }
    } catch (err) {
      skippedRows++;
      warnings.push({
        type: 'ROW_ERROR',
        message: `Error mapping row in ${mapping.sourceTable}: ${(err as Error).message}`,
      });
    }
  }

  // ─── Write output ───
  if (format === 'csv' || format === 'both') {
    writeMappedCsv(outputDir, jobId, mapping.targetTable, mappedRows);
  }
  if (format === 'sql' || format === 'both') {
    sqlData.push({ tableName: mapping.targetTable, rows: mappedRows, phase: phaseName });
  }

  return {
    sourceTable: mapping.sourceTable,
    targetTable: mapping.targetTable,
    inputRows: sourceRows.length,
    outputRows: mappedRows.length,
    skippedRows,
    warnings,
  };
}

/**
 * Special handler for brands — deduplicate from M_Items.Brand column.
 */
function processBrandsSpecial(
  mapping: TableMapping,
  outputDir: string,
  jobId: string,
  context: MappingContext,
  format: string,
  sqlData: { tableName: string; rows: Record<string, unknown>[]; phase: string }[],
  phaseName: string
): TableMappingResult {
  const warnings: MappingWarning[] = [];

  const sourceRows = readExtractedCsv(outputDir, jobId, mapping.sourceTable);
  if (!sourceRows) {
    warnings.push({ type: 'MISSING_SOURCE', message: 'M_Items.csv not found for brand extraction' });
    return {
      sourceTable: 'M_Items', targetTable: 'brands',
      inputRows: 0, outputRows: 0, skippedRows: 0, warnings,
    };
  }

  // Extract and deduplicate brands
  const rawBrands = sourceRows.map((r) => r['Brand']).filter(Boolean);
  const deduplicated = deduplicateBrands(rawBrands);

  // Track typos/fixes for warnings
  const typoFixes: string[] = [];

  const mappedRows: Record<string, unknown>[] = [];
  for (const brand of deduplicated) {
    const uuid = generateUUID();
    // Register in idMap: normalized name → UUID
    registerMapping(context.idMap, 'brands', brand.normalized, uuid);

    // Also register all original variants → same UUID
    for (const orig of brand.originals) {
      const normOrig = normalizeBrand(orig);
      if (normOrig !== orig.trim()) {
        typoFixes.push(`${orig} → ${normOrig}`);
      }
    }

    mappedRows.push({
      id: uuid,
      tenant_id: context.tenantId,
      name: brand.normalized,
      slug: slugify(brand.normalized),
      is_active: true,
      created_at: context.migrationTimestamp,
    });
  }

  if (typoFixes.length > 0) {
    warnings.push({
      type: 'BRAND_TYPO_FIXED',
      message: `Fixed ${typoFixes.length} brand name variants`,
      count: typoFixes.length,
      details: typoFixes.slice(0, 20).join(', '),
    });
  }

  // Write output
  if (format === 'csv' || format === 'both') {
    writeMappedCsv(outputDir, jobId, 'brands', mappedRows);
  }
  if (format === 'sql' || format === 'both') {
    sqlData.push({ tableName: 'brands', rows: mappedRows, phase: phaseName });
  }

  return {
    sourceTable: 'M_Items',
    targetTable: 'brands',
    inputRows: rawBrands.length,
    outputRows: mappedRows.length,
    skippedRows: 0,
    warnings,
  };
}

/**
 * Map a single source row using the column mappings.
 */
function mapRow(
  sourceRow: CsvRow,
  mapping: TableMapping,
  context: MappingContext
): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};

  for (const col of mapping.columns) {
    // Get source value
    let sourceVal = '';
    if (col.source) {
      sourceVal = sourceRow[col.source] || '';
    }

    // Apply transform or default
    let mappedVal: unknown;
    if (col.transform) {
      mappedVal = col.transform(sourceVal, sourceRow, context);
    } else if (col.source) {
      mappedVal = sourceVal.trim();
    } else {
      mappedVal = col.default ?? null;
    }

    // If skip is set and value is empty/null, don't include
    if (col.skip && (mappedVal === null || mappedVal === undefined || mappedVal === '')) {
      continue;
    }

    result[col.target] = mappedVal;
  }

  return result;
}

/**
 * Build the migration report JSON.
 */
function buildMigrationReport(result: MappingResult): Record<string, unknown> {
  return {
    source_format: result.detectedFormat,
    migration_date: new Date().toISOString(),
    tenant_id: result.tenantId,
    branch_id: result.branchId,
    job_id: result.jobId,
    summary: {
      total_input_rows: result.totalInputRows,
      total_output_rows: result.totalOutputRows,
      phases: result.phases.map((p) => ({
        name: p.name,
        tables: p.tables.map((t) => ({
          source: t.sourceTable,
          target: t.targetTable,
          input: t.inputRows,
          output: t.outputRows,
          skipped: t.skippedRows,
        })),
      })),
    },
    warnings: result.warnings,
  };
}
