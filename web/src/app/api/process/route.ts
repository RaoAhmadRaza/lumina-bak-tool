import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import sql from "mssql";
import { v4 as uuid } from "uuid";
import { getConfig } from "@/lib/mssql";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const jobId = uuid().slice(0, 8);
  const dbName = `restore_${jobId}`;
  const backupsDir = path.join(process.cwd(), "..", "backups");
  const outputDir = path.join(process.cwd(), "..", "output", jobId);

  try {
    const formData = await req.formData();
    const file = formData.get("bakfile") as File;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    if (!existsSync(backupsDir)) await mkdir(backupsDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    const bakPath = path.join(backupsDir, `${jobId}.bak`);
    const bytes = await file.arrayBuffer();
    await writeFile(bakPath, Buffer.from(bytes));

    const masterPool = await sql.connect(getConfig("master"));

    const fileList = await masterPool.request().query(
      `RESTORE FILELISTONLY FROM DISK = '/backups/${jobId}.bak'`
    );

    const dataFile = fileList.recordset.find((r: any) => r.Type === "D");
    const logFile = fileList.recordset.find((r: any) => r.Type === "L");

    if (!dataFile || !logFile) {
      await masterPool.close();
      return NextResponse.json({ error: "Invalid backup file" }, { status: 400 });
    }

    await masterPool.request().query(`
      RESTORE DATABASE [${dbName}] FROM DISK = '/backups/${jobId}.bak'
      WITH MOVE '${dataFile.LogicalName}' TO '/var/opt/mssql/data/${dbName}.mdf',
           MOVE '${logFile.LogicalName}' TO '/var/opt/mssql/data/${dbName}.ldf',
           REPLACE
    `);
    await masterPool.close();

    const dbPool = await sql.connect(getConfig(dbName));

    const tablesResult = await dbPool.request().query(
      "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
    );

    const tables: any[] = [];
    for (const row of tablesResult.recordset) {
      const s = row.TABLE_SCHEMA;
      const t = row.TABLE_NAME;
      try {
        const countRes = await dbPool.request().query(`SELECT COUNT(*) as c FROM [${s}].[${t}]`);
        const count = countRes.recordset[0].c;
        if (count === 0) { tables.push({ name: t, rows: 0, status: "empty" }); continue; }

        const dataRes = await dbPool.request().query(`SELECT * FROM [${s}].[${t}]`);
        const rows = dataRes.recordset;
        const cols = Object.keys(rows[0]);

        const header = cols.map(c => `"${c}"`).join(",");
        const csvRows = rows.map((r: any) =>
          cols.map(c => {
            const v = r[c];
            if (v === null || v === undefined) return "";
            const str = String(v).replace(/"/g, '""');
            return `"${str}"`;
          }).join(",")
        );
        const csv = [header, ...csvRows].join("\n");
        await writeFile(path.join(outputDir, `${t}.csv`), csv, "utf-8");
        tables.push({ name: t, rows: count, status: "ok" });
      } catch (e: any) {
        tables.push({ name: t, rows: 0, status: "error", error: e.message });
      }
    }

    const schemaRes = await dbPool.request().query(
      "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_NAME, ORDINAL_POSITION"
    );
    await writeFile(path.join(outputDir, "_schema.json"), JSON.stringify(schemaRes.recordset, null, 2));
    await dbPool.close();

    const cleanPool = await sql.connect(getConfig("master"));
    await cleanPool.request().query(`ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${dbName}]`);
    await cleanPool.close();

    await rm(bakPath);

    const totalRows = tables.reduce((sum, t) => sum + t.rows, 0);
    const exported = tables.filter(t => t.status === "ok").length;

    return NextResponse.json({
      jobId,
      database: dataFile.LogicalName.replace("_Data", ""),
      tables,
      totalTables: tables.length,
      exported,
      totalRows,
    });

  } catch (e: any) {
    try {
      const cleanPool = await sql.connect(getConfig("master"));
      await cleanPool.request().query(`IF DB_ID('${dbName}') IS NOT NULL BEGIN ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${dbName}] END`);
      await cleanPool.close();
    } catch {}
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
