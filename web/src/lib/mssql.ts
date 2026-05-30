import sql from "mssql";

export function getConfig(database?: string): sql.config {
  return {
    user: process.env.MSSQL_USER || "SA",
    password: process.env.MSSQL_PASSWORD || "Lumina@Pos123",
    server: process.env.MSSQL_HOST || "localhost",
    port: parseInt(process.env.MSSQL_PORT || "1433"),
    database: database || "master",
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 120000,
    connectionTimeout: 30000,
  };
}

export async function connectMaster() {
  return sql.connect(getConfig("master"));
}

export async function connectDb(dbName: string) {
  return sql.connect(getConfig(dbName));
}
