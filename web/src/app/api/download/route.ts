import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { readFile, rm } from "fs/promises";
import { execSync } from "child_process";
import path from "path";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId || !/^[a-f0-9-]+$/.test(jobId)) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  const outputDir = path.join(process.cwd(), "..", "output", jobId);
  if (!existsSync(outputDir)) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const zipPath = path.join(process.cwd(), "..", "output", `${jobId}.zip`);

  try {
    execSync(`cd "${outputDir}" && zip -j "${zipPath}" *.csv *.json`);
  } catch {
    return NextResponse.json({ error: "Failed to create ZIP" }, { status: 500 });
  }

  const zipBuffer = await readFile(zipPath);
  await rm(zipPath).catch(() => {});

  return new NextResponse(zipBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="lumina-export-${jobId}.zip"`,
    },
  });
}
