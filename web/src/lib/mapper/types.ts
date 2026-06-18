// ─── Mapping Engine Types ─────────────────────────────────────────────

/** A single column-level mapping rule */
export interface ColumnMapping {
  source: string | null;           // source CSV column name, null = generated
  target: string;                  // LUMINA column name
  transform?: TransformFn;         // optional transform function
  default?: unknown;               // default value if source is null/empty
  skip?: boolean;                  // if true, skip this mapping when source is empty
}

/** Transform function: takes raw value + full row, returns mapped value */
export type TransformFn = (value: string, row: Record<string, string>, context: MappingContext) => unknown;

/** Context passed to every transform function */
export interface MappingContext {
  idMap: IdMap;
  tenantId: string;
  branchId: string;
  migrationTimestamp: string;      // ISO 8601
  jobId: string;
}

/** A single table mapping (source → target) */
export interface TableMapping {
  sourceTable: string;             // CrystalBiz CSV filename (without .csv)
  targetTable: string;             // LUMINA table name
  columns: ColumnMapping[];
  filter?: (row: Record<string, string>) => boolean;  // row filter (e.g. Identiti=2 for customers)
  preProcess?: (rows: Record<string, string>[]) => Record<string, string>[];  // deduplicate, normalize
  idSourceColumn?: string;         // which source column to use for ID mapping
  idMapKey?: string;               // key in IdMap to store the mapping (e.g. "customers")
}

/** Mapping config for a specific POS format */
export interface MappingConfig {
  formatName: string;              // "CrystalBiz"
  signature: string[];             // table names that must all exist
  phases: MappingPhase[];
}

/** A migration phase (group of table mappings that run together) */
export interface MappingPhase {
  name: string;                    // "Phase 1: Reference data"
  description: string;
  tables: TableMapping[];
}

/** ID mapping storage: sourceTable → { sourceId → luminaUUID } */
export interface IdMap {
  brands: Map<string, string>;
  categories: Map<string | number, string>;   // string key = canonical name (derived), number key = CatId (M_ItemCat)
  products: Map<string, string>;
  customers: Map<number, string>;
  suppliers: Map<number, string>;
  employees: Map<number, string>;
  invoices: Map<number, string>;
  purchaseOrders: Map<number, string>;
  bankAccounts: Map<number, string>;
  branches: Map<number, string>;
  users: Map<number, string>;
  // person lookup: PersonId → which map it went to + UUID
  personLookup: Map<number, { type: string; uuid: string }>;
}

/** Result of mapping a single table */
export interface TableMappingResult {
  sourceTable: string;
  targetTable: string;
  inputRows: number;
  outputRows: number;
  skippedRows: number;
  warnings: MappingWarning[];
}

/** A warning generated during mapping */
export interface MappingWarning {
  type: string;
  message: string;
  count?: number;
  details?: string;
}

/** Complete result of the mapping process */
export interface MappingResult {
  jobId: string;
  detectedFormat: string;
  tenantId: string;
  branchId: string;
  phases: {
    name: string;
    tables: TableMappingResult[];
  }[];
  totalInputRows: number;
  totalOutputRows: number;
  warnings: MappingWarning[];
  outputDir: string;
}

/** Row as read from CSV: all values are strings */
export type CsvRow = Record<string, string>;