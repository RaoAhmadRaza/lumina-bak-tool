// ─── CrystalBiz → LUMINA POS Mapping Configuration ──────────────────
// Phase 1: Reference data (categories, brands, branches)
// Phase 2: Entities (products, customers, suppliers, ledger_accounts)

import type { MappingConfig, CsvRow, MappingContext } from '../types';
import {
  normalizeBrand,
  deduplicateBrands,
  slugify,
  parseCrystalBizDate,
  parseDateOnly,
  toDecimal,
  toInt,
  toMoney,
  derivePaymentStatus,
  buildProductDescription,
} from '../transforms';
import { generateUUID, registerMapping, lookupId, registerPerson, resolvePersonId } from '../id-map';

// ═══════════════════════════════════════════════════════════════════════
// THE CONFIG
// ═══════════════════════════════════════════════════════════════════════

export const crystalBizConfig: MappingConfig = {
  formatName: 'CrystalBiz',
  signature: ['M_Items', 'M_Persons', 'M_Sale', 'M_CusBill', 'M_Purchase', 'M_SupBill', 'M_Identity'],

  phases: [
    // ─────────────────────────────────────────────────────────────────
    // PHASE 1: Reference data (no FK dependencies)
    // ─────────────────────────────────────────────────────────────────
    {
      name: 'Phase 1: Reference data',
      description: 'Categories, brands, branches — no foreign keys to resolve',
      tables: [

        // ─── categories (from M_ItemCat) ───
        {
          sourceTable: 'M_ItemCat',
          targetTable: 'categories',
          idSourceColumn: 'CatId',
          idMapKey: 'categories',
          columns: [
            { source: 'CatId', target: 'id', transform: (val, _row, ctx) => {
              const uuid = generateUUID();
              registerMapping(ctx.idMap, 'categories', toInt(val), uuid);
              return uuid;
            }},
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: 'CatName', target: 'name', transform: (val) => (val || 'Not Specified').trim() },
            { source: 'CatName', target: 'slug', transform: (val) => slugify(val || 'not-specified') },
            { source: null, target: 'is_active', default: true },
            { source: 'CatId', target: 'sort_order', transform: (val) => toInt(val, 0) },
            { source: null, target: 'created_at', transform: (_v, _r, ctx) => ctx.migrationTimestamp },
          ],
        },

        // ─── brands (deduplicated from M_Items.Brand) ───
        // This is a SPECIAL mapping — preprocessed by the engine via custom handler
        {
          sourceTable: 'M_Items',
          targetTable: 'brands',
          idMapKey: 'brands',
          columns: [], // handled by preProcess — see engine.ts
          preProcess: (rows) => {
            // Extract unique brands, deduplicate, return as synthetic rows
            const rawBrands = rows.map((r) => r['Brand']).filter(Boolean);
            const deduplicated = deduplicateBrands(rawBrands);

            return deduplicated.map((b) => ({
              _normalized: b.normalized,
              _originals: b.originals.join('|'),
            }));
          },
        },

        // ─── branches (from M_Loc) ───
        {
          sourceTable: 'M_Loc',
          targetTable: 'branches',
          idSourceColumn: 'LocId',
          idMapKey: 'branches',
          columns: [
            { source: 'LocId', target: 'id', transform: (val, _row, ctx) => {
              const uuid = generateUUID();
              registerMapping(ctx.idMap, 'branches', toInt(val), uuid);
              return uuid;
            }},
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: 'Location', target: 'name', transform: (val) => (val || 'Default Location').trim() },
            { source: null, target: 'is_active', default: true },
            { source: 'CDate', target: 'created_at', transform: (val, _r, ctx) => parseCrystalBizDate(val) || ctx.migrationTimestamp },
          ],
        },
      ],
    },

    // ─────────────────────────────────────────────────────────────────
    // PHASE 2: Entities (resolve category/brand FKs)
    // ─────────────────────────────────────────────────────────────────
    {
      name: 'Phase 2: Entities',
      description: 'Products, customers, suppliers, ledger accounts — references Phase 1 IDs',
      tables: [

        // ─── products (from M_Items) ───
        {
          sourceTable: 'M_Items',
          targetTable: 'products',
          idSourceColumn: 'ItemId',
          idMapKey: 'products',
          columns: [
            { source: 'ItemId', target: 'id', transform: (val, _row, ctx) => {
              const uuid = generateUUID();
              registerMapping(ctx.idMap, 'products', val, uuid);
              return uuid;
            }},
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: 'ItemId', target: 'sku' },
            { source: 'ItemId', target: 'barcode' },
            { source: 'ItemName', target: 'name', transform: (val) => (val || '').trim() },
            { source: 'Model', target: 'description', transform: (_val, row) => buildProductDescription(row) },
            { source: 'Brand', target: 'brand_id', transform: (val, _row, ctx) => {
              const normalized = normalizeBrand(val);
              return lookupId(ctx.idMap, 'brands', normalized) || null;
            }},
            { source: 'CatId', target: 'category_id', transform: (val, _row, ctx) => {
              return lookupId(ctx.idMap, 'categories', toInt(val)) || null;
            }},
            { source: 'FxSalePrice', target: 'selling_price', transform: (val) => {
              const num = toDecimal(val, 0);
              return num > 0 ? num.toFixed(4) : null;
            }},
            { source: 'RetailPrice', target: 'retail_price', transform: (val) => {
              const num = toDecimal(val, 0);
              return num > 0 ? num.toFixed(4) : null;
            }},
            { source: null, target: 'cost_price', default: null }, // CCost is always 0
            { source: null, target: 'min_selling_price', default: null }, // MinPrice always 0
            { source: 'Unt', target: 'unit_of_measure', transform: (val) => {
              const u = (val || 'Pc').trim().toUpperCase();
              return u === 'PC' ? 'PCS' : u;
            }},
            { source: null, target: 'is_active', default: true }, // Override broken field
            { source: null, target: 'status', default: 'ACTIVE' },
            { source: null, target: 'type', default: 'STANDARD' },
            { source: null, target: 'tax_rate', default: '0.0000' },
            { source: null, target: 'reorder_point', default: 10 },
            { source: null, target: 'created_at', transform: (_v, _r, ctx) => ctx.migrationTimestamp },
          ],
        },

        // ─── customers (from M_Persons WHERE Identiti=2) ───
        {
          sourceTable: 'M_Persons',
          targetTable: 'customers',
          idMapKey: 'customers',
          filter: (row) => row['Identiti'] === '2',
          columns: [
            { source: 'PersonId', target: 'id', transform: (val, row, ctx) => {
              return registerPerson(ctx.idMap, toInt(val), 2);
            }},
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: 'PerName', target: 'name', transform: (val) => (val || 'Unknown').trim() },
            { source: null, target: 'phone', default: null },
            { source: null, target: 'email', default: null },
            { source: null, target: 'address_line1', default: null },
            { source: null, target: 'city', default: null },
            { source: null, target: 'country', default: 'Pakistan' },
            { source: 'PerBalance', target: 'opening_balance', transform: (val) => toMoney(val) },
            { source: 'TLimit', target: 'credit_limit', transform: (val) => {
              const num = toDecimal(val, 0);
              return num > 0 ? num.toFixed(4) : null;
            }},
            { source: null, target: 'status', default: 'ACTIVE' },
            { source: null, target: 'created_at', transform: (_v, _r, ctx) => ctx.migrationTimestamp },
          ],
        },

        // ─── suppliers (from M_Persons WHERE Identiti=1) ───
        {
          sourceTable: 'M_Persons',
          targetTable: 'suppliers',
          idMapKey: 'suppliers',
          filter: (row) => row['Identiti'] === '1',
          columns: [
            { source: 'PersonId', target: 'id', transform: (val, row, ctx) => {
              return registerPerson(ctx.idMap, toInt(val), 1);
            }},
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: 'PerName', target: 'name', transform: (val) => (val || 'Unknown').trim() },
            { source: null, target: 'phone', default: null },
            { source: null, target: 'email', default: null },
            { source: null, target: 'address_line1', default: null },
            { source: null, target: 'city', default: null },
            { source: null, target: 'country', default: 'Pakistan' },
            { source: null, target: 'currency', default: 'PKR' },
            { source: null, target: 'payment_terms', default: 30 },
            { source: 'PerBalance', target: 'opening_balance', transform: (val) => toMoney(val) },
            { source: null, target: 'status', default: 'ACTIVE' },
            { source: null, target: 'created_at', transform: (_v, _r, ctx) => ctx.migrationTimestamp },
          ],
        },

        // ─── ledger_accounts (from ALL M_Persons, skip PersonId=1 "Not Applicable") ───
        {
          sourceTable: 'M_Persons',
          targetTable: 'ledger_accounts',
          filter: (row) => {
            const pid = parseInt(row['PersonId'], 10);
            const ident = parseInt(row['Identiti'], 10);
            // Skip "Not Applicable" (PersonId=1) and unrecognized types
            return pid !== 1 && ident >= 1 && ident <= 4;
          },
          columns: [
            { source: null, target: 'id', transform: () => generateUUID() },
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: 'PersonId', target: 'entity_id', transform: (val, _row, ctx) => {
              const person = resolvePersonId(ctx.idMap, toInt(val));
              return person?.uuid || null;
            }},
            { source: 'Identiti', target: 'entity_type', transform: (val) => {
              const map: Record<string, string> = { '1': 'SUPPLIER', '2': 'CUSTOMER', '3': 'EMPLOYEE', '4': 'OWNER' };
              return map[val] || 'OTHER';
            }},
            { source: 'PerCredit', target: 'total_credit', transform: (val) => toMoney(val) },
            { source: 'PerDebit', target: 'total_debit', transform: (val) => toMoney(val) },
            { source: 'PerBalance', target: 'balance', transform: (val) => toMoney(val) },
            { source: 'TLimit', target: 'credit_limit', transform: (val) => {
              const num = toDecimal(val, 0);
              return num > 0 ? num.toFixed(4) : null;
            }},
          ],
        },

      ],
    },
  ],
};
