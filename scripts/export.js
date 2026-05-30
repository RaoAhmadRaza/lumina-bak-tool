const sql = require('mssql');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');

const config = {
  user: 'SA',
  password: 'Lumina@Pos123',
  server: 'localhost',
  port: 1433,
  database: 'MMA_DB',
  options: { encrypt: false, trustServerCertificate: true },
};

const OUTPUT = path.join(__dirname, 'output');

async function run() {
  if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT);
  console.log('Connecting to SQL Server...');
  const pool = await sql.connect(config);
  console.log('Connected!\n');

  const tables = (await pool.request().query(
    "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
  )).recordset;

  console.log(`Found ${tables.length} tables\n`);

  let exported = 0;
  let totalRows = 0;

  for (let i = 0; i < tables.length; i++) {
    const s = tables[i].TABLE_SCHEMA;
    const t = tables[i].TABLE_NAME;
    process.stdout.write(`[${i+1}/${tables.length}] ${t}... `);
    try {
      const count = (await pool.request().query(
        `SELECT COUNT(*) as c FROM [${s}].[${t}]`
      )).recordset[0].c;

      if (count === 0) { console.log('empty, skip'); continue; }

      const data = (await pool.request().query(
        `SELECT * FROM [${s}].[${t}]`
      )).recordset;

      const cols = Object.keys(data[0]);
      const writer = createObjectCsvWriter({
        path: path.join(OUTPUT, `${t}.csv`),
        header: cols.map(c => ({ id: c, title: c })),
      });

      await writer.writeRecords(data);
      console.log(`${count} rows`);
      exported++;
      totalRows += count;
    } catch (e) {
      console.log(`error: ${e.message}`);
    }
  }

  const schema = (await pool.request().query(
    "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_NAME, ORDINAL_POSITION"
  )).recordset;
  fs.writeFileSync(path.join(OUTPUT, '_schema.json'), JSON.stringify(schema, null, 2));

  await pool.close();
  console.log(`\n========================================`);
  console.log(`  EXPORT COMPLETE`);
  console.log(`  Tables exported: ${exported}`);
  console.log(`  Total rows: ${totalRows}`);
  console.log(`  Schema: _schema.json`);
  console.log(`  Output: ~/lumina-bak-tool/output/`);
  console.log(`========================================`);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
