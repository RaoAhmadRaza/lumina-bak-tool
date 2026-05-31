# LUMINA BAK Tool — Phase 1 & 2 Integration Guide

> 11 files, 1,651 lines of TypeScript. Zero new dependencies.
> Adds to: `lumina-bak-tool/web/` (your existing Next.js app)

---

## STEP 1: Create the directory structure (on your Mac)

```bash
cd ~/lumina-bak-tool/web

# Create mapper module directories
mkdir -p src/lib/mapper/configs

# Create new API route directories
mkdir -p src/app/api/map
mkdir -p src/app/api/download-mapped
```

---

## STEP 2: Create all 11 files

Copy each file from the download into the matching path. The file structure:

```
web/src/lib/mapper/
├── types.ts              # Type definitions (101 lines)
├── id-map.ts             # UUID generation + ID tracking (129 lines)
├── transforms.ts         # Date parser, brand normalizer, coercions (243 lines)
├── csv-reader.ts         # Read extracted CSVs (152 lines)
├── csv-writer.ts         # Write mapped CSVs + SQL (158 lines)
├── detect.ts             # Auto-detect CrystalBiz format (80 lines)
├── engine.ts             # Core mapping engine (327 lines)
├── index.ts              # Main entry point (81 lines)
└── configs/
    └── crystalbiz.ts     # CrystalBiz mapping config (239 lines)

web/src/app/api/
├── map/
│   └── route.ts          # POST /api/map (75 lines)
└── download-mapped/
    └── route.ts          # GET /api/download-mapped (66 lines)
```

All files are in the download ZIP from this conversation. Copy them into place:

```bash
# If you downloaded the files to ~/Downloads/mapper-files/
# (adjust the source path to wherever you saved them)

# Core mapper module
cp types.ts      ~/lumina-bak-tool/web/src/lib/mapper/
cp id-map.ts     ~/lumina-bak-tool/web/src/lib/mapper/
cp transforms.ts ~/lumina-bak-tool/web/src/lib/mapper/
cp csv-reader.ts ~/lumina-bak-tool/web/src/lib/mapper/
cp csv-writer.ts ~/lumina-bak-tool/web/src/lib/mapper/
cp detect.ts     ~/lumina-bak-tool/web/src/lib/mapper/
cp engine.ts     ~/lumina-bak-tool/web/src/lib/mapper/
cp index.ts      ~/lumina-bak-tool/web/src/lib/mapper/
cp crystalbiz.ts ~/lumina-bak-tool/web/src/lib/mapper/configs/

# API routes
cp map-route.ts            ~/lumina-bak-tool/web/src/app/api/map/route.ts
cp download-mapped-route.ts ~/lumina-bak-tool/web/src/app/api/download-mapped/route.ts
```

---

## STEP 3: Verify — no new dependencies needed

The mapper uses ONLY:
- `crypto.randomUUID()` — built into Node 20
- `fs`, `path`, `child_process` — built into Node
- Next.js `NextRequest`/`NextResponse` — already in your project
- `@/lib/mapper` path alias — already configured in your tsconfig

Check that your `web/tsconfig.json` has the path alias (it should from the original setup):

```bash
cat ~/lumina-bak-tool/web/tsconfig.json | grep -A2 "paths"
```

You should see something like:
```json
"paths": {
  "@/*": ["./src/*"]
}
```

If it's missing, add it under `compilerOptions`.

---

## STEP 4: Test locally

### 4a. Make sure Docker SQL Server is running

```bash
# Check if your lumina-sqlserver container is running
docker ps | grep lumina-sqlserver

# If not running, start it
docker start lumina-sqlserver
```

### 4b. Start the dev server

```bash
cd ~/lumina-bak-tool/web
npm run dev
```

### 4c. Run an extraction first (if you don't have one already)

Open http://localhost:3000 in your browser, upload the MMA_DB .bak file.
Note the `jobId` from the response.

OR if you have an existing extraction from before, find its jobId:

```bash
# List existing extracted jobs
ls ~/lumina-bak-tool/output/
```

### 4d. Test the mapping API with curl

```bash
# Replace YOUR_JOB_ID with the actual jobId
JOB_ID="YOUR_JOB_ID"

# Run the mapping
curl -X POST http://localhost:3000/api/map \
  -H "Content-Type: application/json" \
  -d "{\"jobId\": \"$JOB_ID\", \"format\": \"both\"}"
```

Expected response:
```json
{
  "success": true,
  "detection": {
    "format": "CrystalBiz",
    "confidence": "HIGH",
    "matchedTables": ["M_Items", "M_Persons", "M_Sale", ...]
  },
  "result": {
    "detectedFormat": "CrystalBiz",
    "totalInputRows": 16888,
    "totalOutputRows": 8572,
    "phases": [
      {
        "name": "Phase 1: Reference data",
        "tables": [
          { "source": "M_ItemCat", "target": "categories", "outputRows": 1 },
          { "source": "M_Items", "target": "brands", "outputRows": 35 },
          { "source": "M_Loc", "target": "branches", "outputRows": 1 }
        ]
      },
      {
        "name": "Phase 2: Entities",
        "tables": [
          { "source": "M_Items", "target": "products", "outputRows": 8294 },
          { "source": "M_Persons", "target": "customers", "outputRows": 186 },
          { "source": "M_Persons", "target": "suppliers", "outputRows": 54 },
          { "source": "M_Persons", "target": "ledger_accounts", "outputRows": 247 }
        ]
      }
    ]
  }
}
```

### 4e. Verify the output files

```bash
# Check what was created
ls -la ~/lumina-bak-tool/output/$JOB_ID/lumina/

# You should see:
#   brands.csv
#   branches.csv
#   categories.csv
#   customers.csv
#   ledger_accounts.csv
#   migration.sql
#   products.csv
#   suppliers.csv
#   _id_map.json
#   _migration_report.json
```

### 4f. Inspect the output

```bash
# Check brands (should be ~35 normalized brands)
head -5 ~/lumina-bak-tool/output/$JOB_ID/lumina/brands.csv

# Check customers (should be 186 rows)
wc -l ~/lumina-bak-tool/output/$JOB_ID/lumina/customers.csv

# Check suppliers (should be 54 rows)
wc -l ~/lumina-bak-tool/output/$JOB_ID/lumina/suppliers.csv

# Check products (should be 8294 rows)
wc -l ~/lumina-bak-tool/output/$JOB_ID/lumina/products.csv

# Peek at the SQL
head -30 ~/lumina-bak-tool/output/$JOB_ID/lumina/migration.sql

# Check the migration report
cat ~/lumina-bak-tool/output/$JOB_ID/lumina/_migration_report.json | python3 -m json.tool
```

### 4g. Test the download

```bash
# Download the mapped ZIP
curl -o lumina-mapped.zip "http://localhost:3000/api/download-mapped?jobId=$JOB_ID"

# Check it
unzip -l lumina-mapped.zip
```

---

## STEP 5: Deploy to production (DigitalOcean)

### 5a. Commit and push

```bash
cd ~/lumina-bak-tool

# Add all new files
git add web/src/lib/mapper/
git add web/src/app/api/map/
git add web/src/app/api/download-mapped/

# Commit
git commit -m "feat: add CrystalBiz → LUMINA schema mapping layer (Phase 1+2)

- Auto-detect CrystalBiz format by table signatures
- Phase 1: Extract categories (1), brands (35 normalized), branches (1)
- Phase 2: Map products (8294), customers (186), suppliers (54), ledger_accounts (247)
- Brand normalization: fix 15 typo/case variants (Samsang→Samsung, etc.)
- M_Persons split by Identiti field (1=Supplier, 2=Customer)
- Override broken IsActive field (all false in source)
- Output: mapped CSVs + PostgreSQL INSERT migration.sql
- New API routes: POST /api/map, GET /api/download-mapped"

# Push to GitHub
git push origin main
```

### 5b. Deploy on the server

```bash
# SSH to the droplet
ssh root@168.144.28.33

# Pull the changes
cd ~/lumina-bak-tool
git pull

# Rebuild and restart
docker compose up -d --build

# Watch the build logs
docker compose logs -f web
```

The build should complete without errors. The `next.config.ts` already has `ignoreBuildErrors: true` for TypeScript.

### 5c. Test on production

```bash
# From your Mac, test against the live site
# First upload a .bak and get the jobId, then:

curl -u admin:mora -X POST https://luminapos.me/api/map \
  -H "Content-Type: application/json" \
  -d '{"jobId": "YOUR_JOB_ID", "format": "both"}'

# Download mapped output
curl -u admin:mora -o lumina-mapped.zip \
  "https://luminapos.me/api/download-mapped?jobId=YOUR_JOB_ID"
```

---

## What Each File Does (Quick Reference)

| File | Purpose |
|------|---------|
| `types.ts` | All TypeScript interfaces: MappingConfig, ColumnMapping, IdMap, MappingResult |
| `id-map.ts` | UUID generation via `crypto.randomUUID()`, maps CrystalBiz integer IDs → UUIDs, person type routing (Identiti→customer/supplier/employee) |
| `transforms.ts` | CrystalBiz JS date parser, brand normalization map (15 typos + 50 brands), slugify, money/decimal coercion, payment status derivation |
| `csv-reader.ts` | Custom CSV parser (handles double-quoted fields, embedded commas/newlines), reads from `output/{jobId}/` |
| `csv-writer.ts` | Writes mapped CSVs with proper quoting, generates PostgreSQL INSERT statements, creates `migration.sql` wrapped in BEGIN/COMMIT |
| `detect.ts` | Checks for 7 CrystalBiz signature tables (M_Items, M_Persons, M_Sale, M_CusBill, M_Purchase, M_SupBill, M_Identity) |
| `engine.ts` | The core: reads config phases in FK order, maps each row through column transforms, special brand deduplication handler, writes all outputs |
| `index.ts` | Public API: `detectAndMap(outputDir, jobId, options)` — detects format, picks config, runs engine |
| `configs/crystalbiz.ts` | CrystalBiz-specific: Phase 1 (categories, brands, branches) + Phase 2 (products, customers, suppliers, ledger_accounts) with all column mappings |
| `api/map/route.ts` | `POST /api/map` — accepts `{jobId, tenantId?, format?}`, returns mapping results JSON |
| `api/download-mapped/route.ts` | `GET /api/download-mapped?jobId=xxx` — zips and returns the lumina/ directory |

---

## Data Flow

```
User uploads .bak
        │
        ▼
POST /api/process          (existing — unchanged)
  → Restore SQL Server backup
  → Export all tables as CSVs
  → output/{jobId}/*.csv + _schema.json
        │
        ▼
POST /api/map              (NEW)
  → Read CSVs from output/{jobId}/
  → Auto-detect: CrystalBiz ✓
  → Phase 1: categories, brands, branches
  → Phase 2: products, customers, suppliers, ledger_accounts
  → Write to output/{jobId}/lumina/*.csv + migration.sql
        │
        ▼
GET /api/download-mapped   (NEW)
  → ZIP output/{jobId}/lumina/
  → Return download
```

---

## What's Next (Phase 3, 4, 5 — future sessions)

After Phase 1+2 are working:

- **Phase 3:** invoices, invoice_items, purchase_orders, purchase_order_items
- **Phase 4:** bank_accounts, expense_categories
- **Phase 5:** stock_balance (computed from transaction aggregation)
- **UI integration:** "Map to LUMINA POS" button on the results page
- **Multi-format:** Add RetailMan config alongside CrystalBiz
