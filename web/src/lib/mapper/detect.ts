/**
 * Format detection: identify which POS software produced the backup
 * by checking which tables exist in the extraction output.
 */

export interface DetectionResult {
  format: string;             // "CrystalBiz" | "Unknown"
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  matchedTables: string[];
  missingTables: string[];
}

/** CrystalBiz POS signature: all 7 required tables must exist */
const CRYSTALBIZ_REQUIRED = [
  'M_Items',
  'M_Persons',
  'M_Sale',
  'M_CusBill',
  'M_Purchase',
  'M_SupBill',
  'M_Identity',
];

const CRYSTALBIZ_OPTIONAL = [
  'M_ItemCat',
  'M_Customer',
  'M_Supplier',
  'M_BAccount',
  'M_Transaction',
  'M_Log',
  'M_Loc',
  'M_City',
  'M_Country',
  'M_Curr',
  'M_ExpHeas',
  'M_Expense',
  'M_SaleRet',
  'M_PurchRet',
  'Tbuser',
];

/**
 * Detect the POS format from a list of extracted table names.
 */
export function detectFormat(tableNames: string[]): DetectionResult {
  const tableSet = new Set(tableNames);

  // Check CrystalBiz
  const matched = CRYSTALBIZ_REQUIRED.filter((t) => tableSet.has(t));
  const missing = CRYSTALBIZ_REQUIRED.filter((t) => !tableSet.has(t));

  if (missing.length === 0) {
    // All required tables present
    const optionalMatched = CRYSTALBIZ_OPTIONAL.filter((t) => tableSet.has(t));
    return {
      format: 'CrystalBiz',
      confidence: 'HIGH',
      matchedTables: [...matched, ...optionalMatched],
      missingTables: [],
    };
  }

  if (matched.length >= 5) {
    return {
      format: 'CrystalBiz',
      confidence: 'MEDIUM',
      matchedTables: matched,
      missingTables: missing,
    };
  }

  // Future: add RetailMan, other POS signatures here

  return {
    format: 'Unknown',
    confidence: 'LOW',
    matchedTables: [],
    missingTables: [],
  };
}
