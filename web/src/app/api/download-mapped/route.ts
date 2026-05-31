import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

/**
 * GET /api/download-mapped?jobId=xxx
 *
 * Downloads the mapped LUMINA output as a ZIP file.
 * Contains: mapped CSVs, migration.sql, _id_map.json, _migration_report.json
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    // Resolve output directory
    const outputDir = process.env.OUTPUT_DIR || join(process.cwd(), '..', 'output');
    const luminaDir = join(outputDir, jobId, 'lumina');

    if (!existsSync(luminaDir)) {
      return NextResponse.json(
        { error: `Mapped output for job ${jobId} not found. Run mapping first via POST /api/map.` },
        { status: 404 }
      );
    }

    // Create ZIP using system zip command (same approach as the raw download route)
    const zipPath = join(outputDir, jobId, `lumina-mapped-${jobId}.zip`);

    // Remove old zip if exists
    try { execSync(`rm -f "${zipPath}"`); } catch { /* ignore */ }

    // Create zip of all files in the lumina directory
    execSync(`cd "${luminaDir}" && zip -r "${zipPath}" .`, {
      timeout: 30000,
    });

    // Read the zip file
    const zipBuffer = readFileSync(zipPath);

    // Clean up the zip file
    try { execSync(`rm -f "${zipPath}"`); } catch { /* ignore */ }

    // Return as download
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="lumina-mapped-${jobId}.zip"`,
        'Content-Length': String(zipBuffer.length),
      },
    });
  } catch (err) {
    console.error('Download-mapped error:', err);
    return NextResponse.json(
      { error: `Download failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
