// ─── CrystalBiz Transform Functions ──────────────────────────────────
// Every transform takes (value, row, context) and returns the mapped value.

import type { MappingContext, CsvRow } from './types';
import { generateUUID, registerMapping, lookupId, registerPerson, resolvePersonId } from './id-map';

// ═══════════════════════════════════════════════════════════════════════
// DATE PARSING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse CrystalBiz JS Date.toString() format:
 *   "Thu Oct 02 2025 01:57:00 GMT+0500 (Pakistan Standard Time)"
 * Returns ISO 8601 string or null.
 */
export function parseCrystalBizDate(dateStr: string): string | null {
  if (!dateStr || dateStr.trim() === '') return null;

  // JS Date can parse its own toString() output
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return null;

  // Sentinel check: 1900-01-01 means null in CrystalBiz
  if (parsed.getFullYear() < 2000) return null;

  return parsed.toISOString();
}

/**
 * Extract just the date portion (YYYY-MM-DD) from a CrystalBiz date.
 */
export function parseDateOnly(dateStr: string): string | null {
  const iso = parseCrystalBizDate(dateStr);
  if (!iso) return null;
  return iso.substring(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════
// BRAND NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════

/** Known brand typo/variant fixes. Key = lowercased input. */
const BRAND_FIXES: Record<string, string> = {
  // Typo corrections
  'samsang': 'Samsung',
  'realmi': 'Realme',
  'chaina': 'China',
  'googel': 'Google',
  'huwaei': 'Huawei',
  // Semantic normalization (product names → brand)
  'iphone': 'Apple',
  'ipad': 'Apple',
  'mi': 'Xiaomi',
  '1 plus': 'OnePlus',
  '1plus': 'OnePlus',
  // Case normalization
  'samsung': 'Samsung',
  'oppo': 'Oppo',
  'vivo': 'Vivo',
  'tecno': 'Tecno',
  'poco': 'Poco',
  'itel': 'Itel',
  'decode': 'Decode',
  'sego': 'Sego',
  'vigotel': 'Vigotel',
  'china': 'China',
  'google': 'Google',
  'huawei': 'Huawei',
  'infinix': 'Infinix',
  'nokia': 'Nokia',
  'motorola': 'Motorola',
  'sparx': 'Sparx',
  'honor': 'Honor',
  'zte': 'Zte',
  'htc': 'HTC',
  'tcl': 'TCL',
  'lg': 'LG',
  'lenovo': 'Lenovo',
  'oukitel': 'Oukitel',
  'alcatel': 'Alcatel',
  'ic': 'IC',
  'incel': 'Incel',
  'villon': 'Villon',
  'vilon': 'Villon',
  'cygnal': 'Cygnal',
  'sky': 'Sky',
  'black view': 'Blackview',
  'kxd': 'KXD',
  'xsmart': 'X-Smart',
  'x smart': 'X-Smart',
  'vnus': 'Vnus',
  'repairing': 'Repairing',
  'popular': 'Popular',
  'bold': 'Bold',
  'antina': 'Antina',
  'digit': 'Digit',
};

/**
 * Normalize a brand name: fix typos, case, merge variants.
 */
export function normalizeBrand(raw: string): string {
  if (!raw || raw.trim() === '') return 'Unknown';
  const key = raw.trim().toLowerCase();
  return BRAND_FIXES[key] || toTitleCase(raw.trim());
}

/**
 * Deduplicate brands from an array of raw brand strings.
 * Returns array of { original: string[], normalized: string }.
 */
export function deduplicateBrands(rawBrands: string[]): { normalized: string; originals: string[] }[] {
  const map = new Map<string, Set<string>>();

  for (const raw of rawBrands) {
    const norm = normalizeBrand(raw);
    if (!map.has(norm)) map.set(norm, new Set());
    map.get(norm)!.add(raw);
  }

  return Array.from(map.entries())
    .map(([normalized, originals]) => ({
      normalized,
      originals: Array.from(originals),
    }))
    .sort((a, b) => a.normalized.localeCompare(b.normalized));
}

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════
// Same pattern as BRAND_FIXES: maps lowercased raw M_Items.ItemName
// values to canonical category display names. Covers all 56 distinct
// ItemName values observed across CrystalBiz mobile-parts datasets.
// Unknown values fall through as title-cased originals — no "Not
// Specified" bucket.

const CATEGORY_ALIASES: Record<string, string> = {
  // ── Display / Screen ──
  'lcd unit':             'LCD Unit',
  'lcd':                  'LCD Unit',
  'lcd kada':             'LCD Assembly',
  'lcd jack':             'LCD Connector',
  'lcd flex':             'LCD Flex',
  'led unit':             'LED Unit',
  'tab unit':             'Tablet LCD',
  'tab lcd':              'Tablet LCD',
  'touch':                'Touch Digitizer',
  'oca glass':            'OCA Glass',
  'lite paper':           'Screen Protector',
  // ── LCD Quality Grades ──
  'incel':                'Incell LCD',
  'ic fresh':             'Incell LCD',
  'ic shad':              'Incell LCD',
  'org fresh':            'Original LCD',
  'org shad':             'Original LCD',
  'org':                  'Original LCD',
  // ── Body / Frame ──
  'back':                 'Back Cover',
  'body':                 'Phone Body',
  'mid back':             'Mid Frame',
  'mid':                  'Mid Frame',
  // ── Power ──
  'battery':              'Battery',
  'battery jack':         'Battery Connector',
  'charging pot':         'Charging Port',
  'charging flex':        'Charging Flex',
  'charging base':        'Charging Board',
  'on/off':               'Power Button',
  // ── Camera ──
  'camera lens':          'Camera Lens',
  'front camera':         'Front Camera',
  'back camera':          'Rear Camera',
  'popup camera moter':   'Pop-up Camera Motor',
  // ── Buttons / Sensors ──
  'finger print':         'Fingerprint Sensor',
  'finger flex':          'Fingerprint Flex',
  'side key':             'Side Key',
  'volume':               'Volume Flex',
  // ── Audio ──
  'ringer module':        'Ringer Module',
  'jali':                 'Speaker Mesh',
  'front speaker flex':   'Earpiece Flex',
  'handfree flex':        'Headphone Flex',
  // ── Board / Internal ──
  'board flex':           'Board Flex',
  'sim tray':             'SIM Tray',
  // ── Misc ──
  'parts/tool':           'Parts & Tools',
  'repairing':            'Repair Service',
  'service':              'Repair Service',
};

/**
 * Normalize a raw M_Items.ItemName value to a canonical category name.
 *
 * 1. trim + collapse whitespace + lowercase  →  lookup key
 * 2. If key exists in CATEGORY_ALIASES       →  return canonical name
 * 3. Otherwise                               →  return title-cased original
 *
 * The returned string is used as both:
 *   - The `name` field in categories.csv
 *   - The idMap lookup key for category_id FK resolution
 */
export function normalizeCategory(raw: string): string {
  const key = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!key) return 'Uncategorized';
  return CATEGORY_ALIASES[key] || toTitleCase(key);
}

// ═══════════════════════════════════════════════════════════════════════
// SLUG / TEXT HELPERS
// ═══════════════════════════════════════════════════════════════════════

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function toTitleCase(text: string): string {
  return text.replace(
    /\w\S*/g,
    (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
  );
}

// ═══════════════════════════════════════════════════════════════════════
// NUMERIC COERCION
// ═══════════════════════════════════════════════════════════════════════

/** Parse a numeric string, return as number. Null/empty/NaN → defaultVal. */
export function toDecimal(value: string | null | undefined, defaultVal: number = 0): number {
  if (!value || value.trim() === '') return defaultVal;
  const num = parseFloat(value);
  return isNaN(num) ? defaultVal : num;
}

/** Parse an integer string. Null/empty/NaN → defaultVal. */
export function toInt(value: string | null | undefined, defaultVal: number = 0): number {
  if (!value || value.trim() === '') return defaultVal;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultVal : num;
}

/** Numeric to 4 decimal places for DECIMAL(15,4) columns */
export function toMoney(value: string | null | undefined): string {
  const num = toDecimal(value, 0);
  return num.toFixed(4);
}

// ═══════════════════════════════════════════════════════════════════════
// BOOLEAN / STATUS
// ═══════════════════════════════════════════════════════════════════════

/**
 * CrystalBiz IsActive is broken (all "false") — override to true.
 * This function intentionally ignores the source value.
 */
export function overrideActiveTrue(): boolean {
  return true;
}

/**
 * Derive invoice payment status from paid vs total amounts.
 */
export function derivePaymentStatus(paidStr: string, totalStr: string): string {
  const paid = toDecimal(paidStr);
  const total = toDecimal(totalStr);
  if (total <= 0) return 'PAID';
  if (paid >= total) return 'PAID';
  if (paid > 0) return 'PARTIALLY_PAID';
  return 'UNPAID';
}

// ═══════════════════════════════════════════════════════════════════════
// COLUMN TRANSFORM FACTORIES
// ═══════════════════════════════════════════════════════════════════════
// These return TransformFn closures used in mapping configs.

/** Direct copy with trim */
export const directCopy = (val: string) => (val || '').trim();

/** Copy or return null */
export const copyOrNull = (val: string) => {
  const v = (val || '').trim();
  return v === '' ? null : v;
};

/** Money column (DECIMAL 15,4), null → "0.0000" */
export const moneyCol = (val: string) => toMoney(val);

/** Money column, 0 → null */
export const moneyOrNull = (val: string) => {
  const num = toDecimal(val, 0);
  return num === 0 ? null : num.toFixed(4);
};

/** Parse CrystalBiz date → ISO */
export const dateCol = (val: string) => parseCrystalBizDate(val);

/** Parse CrystalBiz date → YYYY-MM-DD */
export const dateOnlyCol = (val: string) => parseDateOnly(val);

/** Brand column → normalized brand name */
export const brandCol = (val: string) => normalizeBrand(val);

/** Build product description from Model + Detail */
export function buildProductDescription(row: CsvRow): string {
  const parts: string[] = [];
  if (row['Model'] && row['Model'].trim()) parts.push(`Model: ${row['Model'].trim()}`);
  if (row['Detail'] && row['Detail'].trim()) parts.push(row['Detail'].trim());
  return parts.join('. ') || '';
}

/**
 * Compose an enriched product display name:
 *   "{CategoryName} — {Brand} {Model}"
 *
 * Examples:
 *   ("Back Cover", "Apple", row.Model="11 BLACK")   → "Back Cover — Apple 11 BLACK"
 *   ("Battery", "Nokia", row.Model="Nokia 1.4 K…")  → "Battery — Nokia 1.4 K…"
 *   ("Incell LCD", "Apple", row.Model="0")           → "Incell LCD — Apple"
 *   ("Repair Service", "", row.Model="")             → "Repair Service"
 *
 * Edge cases:
 *   - Model is "0" or empty → omitted
 *   - Model starts with brand name → brand prefix stripped to avoid "Nokia Nokia 1.4…"
 *   - Brand empty → "{Category} — {Model}" or just "{Category}"
 */
export function buildProductName(
  row: CsvRow,
  categoryName: string,
  normalizedBrand: string,
): string {
  const rawModel = (row['Model'] || '').trim();
  const modelIsEmpty = !rawModel || rawModel === '0';

  // Strip leading brand name from model to avoid "Nokia Nokia 1.4 K Logo"
  let cleanModel = rawModel;
  if (!modelIsEmpty && normalizedBrand) {
    const brandLower = normalizedBrand.toLowerCase();
    const modelLower = cleanModel.toLowerCase();
    if (modelLower.startsWith(brandLower + ' ')) {
      cleanModel = cleanModel.substring(normalizedBrand.length).trim();
    } else if (modelLower === brandLower) {
      // Model IS just the brand name — treat as empty
      cleanModel = '';
    }
  }

  const hasBrand = !!normalizedBrand && normalizedBrand !== 'Unknown';
  const hasModel = !!cleanModel && cleanModel !== '0';

  // Build the right-hand side of the em dash
  let suffix = '';
  if (hasBrand && hasModel) {
    suffix = `${normalizedBrand} ${cleanModel}`;
  } else if (hasBrand) {
    suffix = normalizedBrand;
  } else if (hasModel) {
    suffix = cleanModel;
  }

  return suffix ? `${categoryName} — ${suffix}` : categoryName;
}