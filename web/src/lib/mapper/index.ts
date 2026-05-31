// ─── LUMINA POS Schema Mapping Layer ─────────────────────────────────
// Entry point: detectAndMap() handles the full flow.
//   1. List extracted tables
//   2. Auto-detect source POS format
//   3. Load the appropriate mapping config
//   4. Run the mapping engine
//   5. Return results + output paths

export { detectFormat } from './detect';
export { runMapping } from './engine';
export { listExtractedTables, readExtractedCsv } from './csv-reader';
export type { MappingResult, MappingWarning, DetectionResult } from './types';
export type { DetectionResult as FormatDetection } from './detect';

import { detectFormat } from './detect';
import { runMapping } from './engine';
import { listExtractedTables } from './csv-reader';
import { crystalBizConfig } from './configs/crystalbiz';
import type { MappingResult } from './types';

/** Supported mapping configs, keyed by format name */
const CONFIGS: Record<string, typeof crystalBizConfig> = {
  CrystalBiz: crystalBizConfig,
};

/**
 * Full pipeline: detect format → run mapping → return results.
 *
 * @param outputDir  - Base output directory (e.g. /app/output or ../output)
 * @param jobId      - Job ID from the extraction step
 * @param options    - tenantId, format (csv/sql/both)
 */
export async function detectAndMap(
  outputDir: string,
  jobId: string,
  options: {
    tenantId?: string;
    format?: 'csv' | 'sql' | 'both';
  } = {}
): Promise<{
  detection: ReturnType<typeof detectFormat>;
  result: MappingResult | null;
  error: string | null;
}> {
  // Step 1: List extracted tables
  const tables = listExtractedTables(outputDir, jobId);

  if (tables.length === 0) {
    return {
      detection: { format: 'Unknown', confidence: 'LOW', matchedTables: [], missingTables: [] },
      result: null,
      error: `No extracted CSVs found for job ${jobId}. Run extraction first.`,
    };
  }

  // Step 2: Detect format
  const detection = detectFormat(tables);

  if (detection.format === 'Unknown') {
    return {
      detection,
      result: null,
      error: `Could not identify the POS format. Found ${tables.length} tables but none match a known signature.`,
    };
  }

  // Step 3: Get config
  const config = CONFIGS[detection.format];
  if (!config) {
    return {
      detection,
      result: null,
      error: `Detected format "${detection.format}" but no mapping config is available yet.`,
    };
  }

  // Step 4: Run mapping
  const result = await runMapping(config, outputDir, jobId, options);

  return { detection, result, error: null };
}
