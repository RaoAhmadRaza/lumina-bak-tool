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
import { normalizeBrand, normalizeCategory, deduplicateBrands, slugify, toDecimal } from './transforms';

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

  const sqlData: { tableName: string; rows: Record<string, unknown>[]; phase: string }[] = [];

  // ─── Execute each phase in order ───
  for (const phase of config.phases) {
    const phaseResult = {
      name: phase.name,
      tables: [] as TableMappingResult[],
    };

    for (const tableMapping of phase.tables) {
      let tableResult: TableMappingResult;

      // Special handler for stock_balance computation
      if (tableMapping.sourceTable === '_STOCK_COMPUTE_') {
        tableResult = computeStockBalance(outputDir, jobId, context, format, sqlData, phase.name);
      } else {
        tableResult = processTable(tableMapping, outputDir, jobId, context, format, sqlData, phase.name);
      }

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
 * Process a single table mapping.
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

  // ─── Handle special "categories" derivation from ItemName ───
  // When M_ItemCat is degenerate (1 row = "Not Specified"), derive real
  // categories from M_Items.ItemName instead. Falls through to normal
  // processTable path if M_ItemCat has >1 meaningful row.
  if (mapping.targetTable === 'categories' && isCategoryTableDegenerate(outputDir, jobId)) {
    return processCategoriesFromItems(outputDir, jobId, context, format, sqlData, phaseName);
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
      inputRows: 0, outputRows: 0, skippedRows: 0, warnings,
    };
  }

  // ─── Apply filter ───
  let filteredRows = sourceRows;
  if (mapping.filter) {
    filteredRows = sourceRows.filter(mapping.filter);
  }

  // ─── Apply preProcess ───
  if (mapping.preProcess) {
    filteredRows = mapping.preProcess(filteredRows);
  }

  // ─── Map each row ───
  const mappedRows: Record<string, unknown>[] = [];
  let skippedRows = 0;
  let orphanCount = 0;

  for (const sourceRow of filteredRows) {
    try {
      const mappedRow = mapRow(sourceRow, mapping, context);
      if (mappedRow) {
        // Check for null FK references (orphaned rows)
        const hasNullFk = Object.entries(mappedRow).some(
          ([key, val]) => (key.endsWith('_id') && key !== 'tenant_id' && key !== 'branch_id' && val === null)
        );
        if (hasNullFk) orphanCount++;

        mappedRows.push(mappedRow);
      } else {
        skippedRows++;
      }
    } catch (err) {
      skippedRows++;
      if (skippedRows <= 3) {
        warnings.push({
          type: 'ROW_ERROR',
          message: `Error mapping row in ${mapping.sourceTable}: ${(err as Error).message}`,
        });
      }
    }
  }

  if (orphanCount > 0) {
    warnings.push({
      type: 'ORPHANED_FK',
      message: `${orphanCount} rows in ${mapping.targetTable} have null FK references (source ID not found in parent table)`,
      count: orphanCount,
    });
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
 * Special handler for brands deduplication.
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
    return { sourceTable: 'M_Items', targetTable: 'brands', inputRows: 0, outputRows: 0, skippedRows: 0, warnings };
  }

  const rawBrands = sourceRows.map((r) => r['Brand']).filter(Boolean);
  const deduplicated = deduplicateBrands(rawBrands);
  const typoFixes: string[] = [];

  const mappedRows: Record<string, unknown>[] = [];
  for (const brand of deduplicated) {
    const uuid = generateUUID();
    registerMapping(context.idMap, 'brands', brand.normalized, uuid);

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

  if (format === 'csv' || format === 'both') {
    writeMappedCsv(outputDir, jobId, 'brands', mappedRows);
  }
  if (format === 'sql' || format === 'both') {
    sqlData.push({ tableName: 'brands', rows: mappedRows, phase: phaseName });
  }

  return {
    sourceTable: 'M_Items', targetTable: 'brands',
    inputRows: rawBrands.length, outputRows: mappedRows.length,
    skippedRows: 0, warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY DERIVATION FROM ITEM NAMES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check whether M_ItemCat.csv is degenerate (useless as a category source).
 *
 * Returns true (= derive from ItemName instead) when:
 *   - M_ItemCat.csv doesn't exist
 *   - It has 0 rows
 *   - It has exactly 1 row whose CatName is "Not Specified" or empty
 *
 * Returns false (= use M_ItemCat normally via processTable) when it
 * has >1 row or a single row with a meaningful name.
 */
function isCategoryTableDegenerate(outputDir: string, jobId: string): boolean {
  const rows = readExtractedCsv(outputDir, jobId, 'M_ItemCat');
  if (!rows || rows.length === 0) return true;
  if (rows.length > 1) return false;

  // Single row — degenerate only if it's the placeholder
  const name = (rows[0]['CatName'] || '').trim().toLowerCase();
  return name === 'not specified' || name === '';
}

/**
 * Derive categories from M_Items.ItemName when M_ItemCat is degenerate.
 * Structural sibling of processBrandsSpecial() — same pattern:
 *   1. Read M_Items.csv
 *   2. Extract + normalize + deduplicate ItemName values
 *   3. Generate UUID per unique category, register in idMap
 *   4. Write categories.csv
 */
function processCategoriesFromItems(
  outputDir: string,
  jobId: string,
  context: MappingContext,
  format: string,
  sqlData: { tableName: string; rows: Record<string, unknown>[]; phase: string }[],
  phaseName: string,
): TableMappingResult {
  const warnings: MappingWarning[] = [];

  const sourceRows = readExtractedCsv(outputDir, jobId, 'M_Items');
  if (!sourceRows) {
    warnings.push({ type: 'MISSING_SOURCE', message: 'M_Items.csv not found — cannot derive categories from ItemName' });
    return { sourceTable: 'M_Items (ItemName)', targetTable: 'categories', inputRows: 0, outputRows: 0, skippedRows: 0, warnings };
  }

  // ── Collect unique canonical category names ──
  const seen = new Set<string>();
  const canonicalNames: string[] = [];
  const aliasFixes: string[] = [];

  for (const row of sourceRows) {
    const raw = (row['ItemName'] || '').trim();
    if (!raw) continue;

    const canonical = normalizeCategory(raw);

    // Track alias/normalization fixes for the migration report
    const key = raw.replace(/\s+/g, ' ').toLowerCase();
    if (key !== canonical.toLowerCase()) {
      const fix = `${raw}→${canonical}`;
      if (!aliasFixes.includes(fix)) aliasFixes.push(fix);
    }

    if (!seen.has(canonical)) {
      seen.add(canonical);
      canonicalNames.push(canonical);
    }
  }

  // Sort alphabetically for deterministic, scannable output
  canonicalNames.sort();

  // ── Generate rows + register in idMap ──
  const mappedRows: Record<string, unknown>[] = [];

  for (let i = 0; i < canonicalNames.length; i++) {
    const name = canonicalNames[i];
    const uuid = generateUUID();
    registerMapping(context.idMap, 'categories', name, uuid);

    mappedRows.push({
      id: uuid,
      tenant_id: context.tenantId,
      name,
      slug: slugify(name),
      is_active: true,
      sort_order: i,
      created_at: context.migrationTimestamp,
    });
  }

  // ── Warnings ──
  if (aliasFixes.length > 0) {
    warnings.push({
      type: 'CATEGORY_ALIAS_APPLIED',
      message: `${aliasFixes.length} ItemName variants mapped to canonical categories`,
      count: aliasFixes.length,
      details: aliasFixes.slice(0, 30).join(', '),
    });
  }

  // ── Write output ──
  if (format === 'csv' || format === 'both') {
    writeMappedCsv(outputDir, jobId, 'categories', mappedRows);
  }
  if (format === 'sql' || format === 'both') {
    sqlData.push({ tableName: 'categories', rows: mappedRows, phase: phaseName });
  }

  return {
    sourceTable: 'M_Items (ItemName)',
    targetTable: 'categories',
    inputRows: sourceRows.length,
    outputRows: mappedRows.length,
    skippedRows: 0,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// STOCK BALANCE COMPUTATION (Phase 5 — multi-source)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute stock_balance from M_SupBill (purchases) and M_CusBill (sales).
 * For each product: qty_on_hand = total_purchased - total_sold
 *                   avg_cost = weighted average from purchases
 */
function computeStockBalance(
  outputDir: string,
  jobId: string,
  context: MappingContext,
  format: string,
  sqlData: { tableName: string; rows: Record<string, unknown>[]; phase: string }[],
  phaseName: string
): TableMappingResult {
  const warnings: MappingWarning[] = [];

  // Read purchase line items
  const supBillRows = readExtractedCsv(outputDir, jobId, 'M_SupBill');
  // Read sale line items
  const cusBillRows = readExtractedCsv(outputDir, jobId, 'M_CusBill');

  if (!supBillRows && !cusBillRows) {
    warnings.push({ type: 'MISSING_SOURCE', message: 'Neither M_SupBill nor M_CusBill found — cannot compute stock' });
    return { sourceTable: 'M_SupBill+M_CusBill', targetTable: 'stock_balance', inputRows: 0, outputRows: 0, skippedRows: 0, warnings };
  }

  // Aggregate purchased quantities and costs per ItemId
  const stockMap = new Map<string, { purchased: number; sold: number; totalCost: number }>();

  if (supBillRows) {
    for (const row of supBillRows) {
      const itemId = row['ItemId'];
      if (!itemId) continue;
      const qty = toDecimal(row['Qty'], 0);
      const cost = toDecimal(row['CostPrice'], 0);
      const ret = toDecimal(row['PurchReturn'], 0);

      if (!stockMap.has(itemId)) stockMap.set(itemId, { purchased: 0, sold: 0, totalCost: 0 });
      const entry = stockMap.get(itemId)!;
      entry.purchased += qty - ret;
      entry.totalCost += cost * (qty - ret);
    }
  }

  if (cusBillRows) {
    for (const row of cusBillRows) {
      const itemId = row['ItemId'];
      if (!itemId) continue;
      const qty = toDecimal(row['Qty'], 0);
      const saleRet = toDecimal(row['SaleReturn'], 0);

      if (!stockMap.has(itemId)) stockMap.set(itemId, { purchased: 0, sold: 0, totalCost: 0 });
      const entry = stockMap.get(itemId)!;
      entry.sold += qty - saleRet;
    }
  }

  // Get the first branch UUID
  const firstBranch = context.idMap.branches.values().next().value || context.branchId;

  // Build output rows
  const mappedRows: Record<string, unknown>[] = [];
  let skippedItems = 0;

  for (const [itemId, data] of stockMap) {
    const productUuid = lookupId(context.idMap, 'products', itemId);
    if (!productUuid) {
      skippedItems++;
      continue;
    }

    const qtyOnHand = data.purchased - data.sold;
    const avgCost = data.purchased > 0 ? data.totalCost / data.purchased : 0;

    mappedRows.push({
      id: generateUUID(),
      tenant_id: context.tenantId,
      product_id: productUuid,
      branch_id: firstBranch,
      qty_on_hand: qtyOnHand.toFixed(4),
      avg_cost: avgCost.toFixed(4),
    });
  }

  if (skippedItems > 0) {
    warnings.push({
      type: 'ORPHANED_STOCK_ITEMS',
      message: `${skippedItems} ItemIds in purchase/sale data not found in products — skipped`,
      count: skippedItems,
    });
  }

  const negativeStock = mappedRows.filter((r) => toDecimal(r['qty_on_hand'] as string, 0) < 0).length;
  if (negativeStock > 0) {
    warnings.push({
      type: 'NEGATIVE_STOCK',
      message: `${negativeStock} products have negative stock (sold more than purchased in this dataset)`,
      count: negativeStock,
    });
  }

  if (format === 'csv' || format === 'both') {
    writeMappedCsv(outputDir, jobId, 'stock_balance', mappedRows);
  }
  if (format === 'sql' || format === 'both') {
    sqlData.push({ tableName: 'stock_balance', rows: mappedRows, phase: phaseName });
  }

  const totalInput = (supBillRows?.length || 0) + (cusBillRows?.length || 0);
  return {
    sourceTable: 'M_SupBill+M_CusBill',
    targetTable: 'stock_balance',
    inputRows: totalInput,
    outputRows: mappedRows.length,
    skippedRows: skippedItems,
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
    let sourceVal = '';
    if (col.source) {
      sourceVal = sourceRow[col.source] || '';
    }

    let mappedVal: unknown;
    if (col.transform) {
      mappedVal = col.transform(sourceVal, sourceRow, context);
    } else if (col.source) {
      mappedVal = sourceVal.trim();
    } else {
      mappedVal = col.default ?? null;
    }

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