// ─── CrystalBiz → LUMINA POS Mapping Configuration ──────────────────
// Phase 1: Reference data (categories, brands, branches)
// Phase 2: Entities (products, customers, suppliers, ledger_accounts)
// Phase 3: Transactions (invoices, invoice_items, purchase_orders, purchase_order_items)
// Phase 4: Financial (accounts, expense_categories)
// Phase 5: Computed (stock_balance)

import type { MappingConfig, CsvRow, MappingContext } from '../types';
import {
  normalizeBrand,
  normalizeCategory,
  deduplicateBrands,
  slugify,
  parseCrystalBizDate,
  parseDateOnly,
  toDecimal,
  toInt,
  toMoney,
  derivePaymentStatus,
  buildProductDescription,
  buildProductName,
} from '../transforms';
import { generateUUID, registerMapping, lookupId, registerPerson, resolvePersonId } from '../id-map';

// ═══════════════════════════════════════════════════════════════════════
// ACCOUNT GROUP MAPPING (MGroupId → LUMINA account_type)
// ═══════════════════════════════════════════════════════════════════════
const ACCOUNT_GROUP_MAP: Record<string, string> = {
  '1': 'ASSET',
  '2': 'LIABILITY',
  '3': 'EQUITY',
  '4': 'REVENUE',
  '5': 'EXPENSE',
};

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
        // NOTE: When M_ItemCat is degenerate (single "Not Specified" row),
        // engine.ts intercepts this and calls processCategoriesFromItems()
        // instead, deriving real categories from M_Items.ItemName.
        // This config is only used when M_ItemCat has real data.
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
        {
          sourceTable: 'M_Items',
          targetTable: 'brands',
          idMapKey: 'brands',
          columns: [],
          preProcess: (rows) => {
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
        // CHANGED: name enriched, category_id from ItemName, price swap,
        //          retail_price removed, cost_price NOT NULL, tax_rate 5,2
        {
          sourceTable: 'M_Items',
          targetTable: 'products',
          idSourceColumn: 'ItemId',
          idMapKey: 'products',
          columns: [
            // ── Identity ──
            { source: 'ItemId', target: 'id', transform: (val, _row, ctx) => {
              const uuid = generateUUID();
              registerMapping(ctx.idMap, 'products', val, uuid);
              return uuid;
            }},
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: 'ItemId', target: 'sku' },
            { source: 'ItemId', target: 'barcode' },

            // ── Name (ENRICHED): "{CategoryName} — {Brand} {Model}" ──
            { source: 'ItemName', target: 'name', transform: (val, row) => {
              const categoryName = normalizeCategory(val);
              const brand = normalizeBrand(row['Brand'] || '');
              return buildProductName(row, categoryName, brand);
            }},

            // ── Description (unchanged) ──
            { source: 'Model', target: 'description', transform: (_val, row) => buildProductDescription(row) },

            // ── Foreign Keys ──
            { source: 'Brand', target: 'brand_id', transform: (val, _row, ctx) => {
              const normalized = normalizeBrand(val);
              return lookupId(ctx.idMap, 'brands', normalized) || null;
            }},
            // CHANGED: category_id resolved by normalizeCategory(ItemName),
            // with CatId fallback for the non-degenerate M_ItemCat path.
            { source: 'ItemName', target: 'category_id', transform: (val, row, ctx) => {
              // Primary: lookup by canonical category name (degenerate path)
              const byName = lookupId(ctx.idMap, 'categories', normalizeCategory(val));
              if (byName) return byName;
              // Fallback: lookup by CatId integer (non-degenerate path)
              return lookupId(ctx.idMap, 'categories', toInt(row['CatId'])) || null;
            }},

            // ── Prices ──
            // SWAP: RetailPrice → selling_price (customer-facing, higher)
            //       FxSalePrice → wholesale_price (dealer price, lower)
            //       retail_price REMOVED (not in schema)
            { source: 'RetailPrice', target: 'selling_price', transform: (val) => {
              const num = toDecimal(val, 0);
              return num > 0 ? num.toFixed(4) : '0.0000';
            }},
            { source: null, target: 'cost_price', default: '0.0000' },
            { source: null, target: 'min_selling_price', default: null },
            { source: 'FxSalePrice', target: 'wholesale_price', transform: (val) => {
              const num = toDecimal(val, 0);
              return num > 0 ? num.toFixed(4) : null;
            }},

            // ── Units / Tax ──
            { source: 'Unt', target: 'unit_of_measure', transform: (val) => {
              const u = (val || 'Pc').trim().toUpperCase();
              return u === 'PC' ? 'PCS' : u;
            }},
            { source: null, target: 'tax_rate', default: '0.00' },

            // ── Stock thresholds ──
            { source: 'QtyBelow', target: 'reorder_point', transform: (val) => {
              const n = toInt(val, 0);
              return n >= 0 ? n : 0;
            }},

            // ── Status / Type ──
            { source: null, target: 'is_active', default: true },
            { source: null, target: 'status', default: 'ACTIVE' },
            { source: null, target: 'type', default: 'STANDARD' },

            // ── Timestamp ──
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

        // ─── ledger_accounts (from ALL M_Persons, skip PersonId=1) ───
        {
          sourceTable: 'M_Persons',
          targetTable: 'ledger_accounts',
          filter: (row) => {
            const pid = parseInt(row['PersonId'], 10);
            const ident = parseInt(row['Identiti'], 10);
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

    // ─────────────────────────────────────────────────────────────────
    // PHASE 3: Transactions (resolve entity FKs from Phase 2)
    // ─────────────────────────────────────────────────────────────────
    {
      name: 'Phase 3: Transactions',
      description: 'Invoices, invoice items, purchase orders, PO items',
      tables: [

        // ─── invoices (from M_Sale) ───
        {
          sourceTable: 'M_Sale',
          targetTable: 'invoices',
          idMapKey: 'invoices',
          columns: [
            { source: 'CBillNo', target: 'id', transform: (val, _row, ctx) => {
              const uuid = generateUUID();
              registerMapping(ctx.idMap, 'invoices', toInt(val), uuid);
              return uuid;
            }},
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: null, target: 'branch_id', transform: (_v, _r, ctx) => {
              // Use the first branch from the map
              const firstBranch = ctx.idMap.branches.values().next().value;
              return firstBranch || ctx.branchId;
            }},
            { source: 'CBillNo', target: 'invoice_number', transform: (val) => `MIG-${val}` },
            { source: 'PersonId', target: 'customer_id', transform: (val, _row, ctx) => {
              const person = resolvePersonId(ctx.idMap, toInt(val));
              // Sales mainly go to customers, but edge cases exist
              return person?.uuid || null;
            }},
            { source: 'Cus_Amount', target: 'subtotal', transform: (val) => toMoney(val) },
            { source: 'Tot_Amount', target: 'grand_total', transform: (val) => toMoney(val) },
            { source: 'Discount', target: 'discount_total', transform: (val) => toMoney(val) },
            { source: 'GST', target: 'tax_total', transform: (val) => toMoney(val) },
            { source: 'Cus_Payed', target: 'paid_amount', transform: (val) => toMoney(val) },
            { source: 'Cus_Balance', target: 'balance_due', transform: (val) => toMoney(val) },
            { source: null, target: 'status', default: 'COMPLETED' },
            { source: null, target: 'payment_status', transform: (_v, row) => {
              return derivePaymentStatus(row['Cus_Payed'], row['Tot_Amount']);
            }},
            { source: 'SaleRet', target: 'return_amount', transform: (val) => toMoney(val) },
            { source: 'CBilEntry_Date', target: 'invoice_date', transform: (val) => parseDateOnly(val) },
            { source: 'Cus_Note', target: 'notes', transform: (val) => (val || '').trim() || null },
            { source: 'CBilEntry_Date', target: 'created_at', transform: (val, _r, ctx) => parseCrystalBizDate(val) || ctx.migrationTimestamp },
          ],
        },

        // ─── invoice_items (from M_CusBill) ───
        {
          sourceTable: 'M_CusBill',
          targetTable: 'invoice_items',
          columns: [
            { source: null, target: 'id', transform: () => generateUUID() },
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: 'CBillNo', target: 'invoice_id', transform: (val, _row, ctx) => {
              return lookupId(ctx.idMap, 'invoices', toInt(val)) || null;
            }},
            { source: 'ItemId', target: 'product_id', transform: (val, _row, ctx) => {
              return lookupId(ctx.idMap, 'products', val) || null;
            }},
            { source: 'SalePrice', target: 'unit_price', transform: (val) => toMoney(val) },
            { source: 'CostPrice', target: 'cost_price', transform: (val) => toMoney(val) },
            { source: 'Qty', target: 'qty', transform: (val) => toDecimal(val, 0).toFixed(4) },
            { source: 'Total', target: 'line_total', transform: (val) => toMoney(val) },
            { source: 'Discount', target: 'discount_amount', transform: (val) => toMoney(val) },
            { source: null, target: 'tax_amount', default: '0.0000' },
            { source: null, target: 'profit', transform: (_v, row) => {
              const sale = toDecimal(row['SalePrice'], 0);
              const cost = toDecimal(row['CostPrice'], 0);
              const qty = toDecimal(row['Qty'], 0);
              const disc = toDecimal(row['Discount'], 0);
              return ((sale - cost) * qty - disc).toFixed(4);
            }},
            { source: 'BillDate', target: 'created_at', transform: (val, _r, ctx) => parseCrystalBizDate(val) || ctx.migrationTimestamp },
          ],
        },

        // ─── purchase_orders (from M_Purchase) ───
        {
          sourceTable: 'M_Purchase',
          targetTable: 'purchase_orders',
          idMapKey: 'purchaseOrders',
          columns: [
            { source: 'BillNo', target: 'id', transform: (val, _row, ctx) => {
              const uuid = generateUUID();
              registerMapping(ctx.idMap, 'purchaseOrders', toInt(val), uuid);
              return uuid;
            }},
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: null, target: 'branch_id', transform: (_v, _r, ctx) => {
              const firstBranch = ctx.idMap.branches.values().next().value;
              return firstBranch || ctx.branchId;
            }},
            { source: 'BillNo', target: 'po_number', transform: (val) => `MIG-PO-${val}` },
            { source: 'PersonId', target: 'supplier_id', transform: (val, _row, ctx) => {
              const person = resolvePersonId(ctx.idMap, toInt(val));
              return person?.uuid || null;
            }},
            { source: 'Sup_Amount', target: 'subtotal', transform: (val) => toMoney(val) },
            { source: 'Tot_Amount', target: 'grand_total', transform: (val) => toMoney(val) },
            { source: 'Discount', target: 'discount_total', transform: (val) => toMoney(val) },
            { source: 'ShipCost', target: 'freight_charges', transform: (val) => toMoney(val) },
            { source: 'ExchRate', target: 'exchange_rate', transform: (val) => {
              const rate = toDecimal(val, 0);
              return rate > 0 ? rate.toFixed(6) : '1.000000';
            }},
            { source: null, target: 'currency', default: 'PKR' },
            { source: null, target: 'status', default: 'RECEIVED' },
            { source: 'SBilEntry_Date', target: 'order_date', transform: (val) => parseDateOnly(val) },
            { source: 'Sup_Note', target: 'notes', transform: (val, row) => {
              const parts: string[] = [];
              if (val && val.trim()) parts.push(val.trim());
              if (row['SupInvo'] && row['SupInvo'].trim()) parts.push(`Supplier Invoice: ${row['SupInvo'].trim()}`);
              return parts.length > 0 ? parts.join('. ') : null;
            }},
            { source: 'SBilEntry_Date', target: 'created_at', transform: (val, _r, ctx) => parseCrystalBizDate(val) || ctx.migrationTimestamp },
          ],
        },

        // ─── purchase_order_items (from M_SupBill) ───
        {
          sourceTable: 'M_SupBill',
          targetTable: 'purchase_order_items',
          columns: [
            { source: null, target: 'id', transform: () => generateUUID() },
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: 'BillNo', target: 'po_id', transform: (val, _row, ctx) => {
              return lookupId(ctx.idMap, 'purchaseOrders', toInt(val)) || null;
            }},
            { source: 'ItemId', target: 'product_id', transform: (val, _row, ctx) => {
              return lookupId(ctx.idMap, 'products', val) || null;
            }},
            { source: 'CostPrice', target: 'unit_cost', transform: (val) => toMoney(val) },
            { source: 'Qty', target: 'qty_ordered', transform: (val) => toDecimal(val, 0).toFixed(4) },
            { source: 'Qty', target: 'qty_received', transform: (val) => toDecimal(val, 0).toFixed(4) },
            { source: 'Total', target: 'line_total', transform: (val) => toMoney(val) },
            { source: 'Discount', target: 'discount_amount', transform: (val) => toMoney(val) },
            { source: 'BillDate', target: 'created_at', transform: (val, _r, ctx) => parseCrystalBizDate(val) || ctx.migrationTimestamp },
          ],
        },
      ],
    },

    // ─────────────────────────────────────────────────────────────────
    // PHASE 4: Financial (chart of accounts, expense categories)
    // ─────────────────────────────────────────────────────────────────
    {
      name: 'Phase 4: Financial',
      description: 'Chart of accounts, expense categories',
      tables: [

        // ─── accounts (from M_BAccount — full chart of accounts) ───
        {
          sourceTable: 'M_BAccount',
          targetTable: 'accounts',
          idMapKey: 'bankAccounts',
          columns: [
            { source: 'AccId', target: 'id', transform: (val, _row, ctx) => {
              const uuid = generateUUID();
              registerMapping(ctx.idMap, 'bankAccounts', toInt(val), uuid);
              return uuid;
            }},
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: 'AccName', target: 'name', transform: (val) => (val || '').trim() },
            { source: 'AccName', target: 'slug', transform: (val) => slugify(val || '') },
            { source: 'MGroupId', target: 'account_type', transform: (val) => {
              return ACCOUNT_GROUP_MAP[val] || 'OTHER';
            }},
            { source: 'Dr', target: 'total_debit', transform: (val) => toMoney(val) },
            { source: 'Cr', target: 'total_credit', transform: (val) => toMoney(val) },
            { source: 'Bal', target: 'balance', transform: (val) => toMoney(val) },
            { source: 'BankName', target: 'bank_name', transform: (val) => (val || '').trim() || null },
            { source: 'AtmNo', target: 'account_number', transform: (val) => (val || '').trim() || null },
            { source: 'ReadOnly', target: 'is_system', transform: (val) => val === 'true' },
            { source: null, target: 'is_active', default: true },
            { source: 'CreationDate', target: 'created_at', transform: (val, _r, ctx) => parseCrystalBizDate(val) || ctx.migrationTimestamp },
          ],
        },

        // ─── expense_categories (from M_ExpHeas) ───
        {
          sourceTable: 'M_ExpHeas',
          targetTable: 'expense_categories',
          columns: [
            { source: null, target: 'id', transform: () => generateUUID() },
            { source: null, target: 'tenant_id', transform: (_v, _r, ctx) => ctx.tenantId },
            { source: 'ExpId', target: 'sort_order', transform: (val) => toInt(val, 0) },
            { source: 'ExpName', target: 'name', transform: (val) => (val || '').trim() },
            { source: 'ExpName', target: 'slug', transform: (val) => slugify(val || '') },
            { source: null, target: 'is_active', default: true },
            { source: null, target: 'created_at', transform: (_v, _r, ctx) => ctx.migrationTimestamp },
          ],
        },
      ],
    },

    // ─────────────────────────────────────────────────────────────────
    // PHASE 5: Computed (stock balance from transaction aggregation)
    // ─────────────────────────────────────────────────────────────────
    {
      name: 'Phase 5: Computed',
      description: 'Stock balance computed from purchase and sale line items',
      tables: [
        // stock_balance is a SPECIAL multi-source computation
        // Handled by engine.ts computeStockBalance() — uses a placeholder here
        {
          sourceTable: '_STOCK_COMPUTE_',
          targetTable: 'stock_balance',
          columns: [],
        },
      ],
    },
  ],
};