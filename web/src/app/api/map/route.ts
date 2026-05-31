import { NextRequest, NextResponse } from 'next/server';
import { detectAndMap } from '@/lib/mapper';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * POST /api/map
 * Body: { jobId: string, tenantId?: string, format?: 'csv' | 'sql' | 'both' }
 *
 * Runs the schema mapping on an already-extracted job.
 * The extraction must have been done first via POST /api/process.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId, tenantId, format } = body;

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    // Resolve output directory (same env var as process/download routes)
    const outputDir = process.env.OUTPUT_DIR || join(process.cwd(), '..', 'output');

    // Verify the job exists
    const jobDir = join(outputDir, jobId);
    if (!existsSync(jobDir)) {
      return NextResponse.json(
        { error: `Job ${jobId} not found. Run extraction first.` },
        { status: 404 }
      );
    }

    // Run the mapping
    const { detection, result, error } = await detectAndMap(outputDir, jobId, {
      tenantId,
      format: format || 'both',
    });

    if (error) {
      return NextResponse.json({ error, detection }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      detection,
      result: {
        jobId: result!.jobId,
        detectedFormat: result!.detectedFormat,
        tenantId: result!.tenantId,
        branchId: result!.branchId,
        totalInputRows: result!.totalInputRows,
        totalOutputRows: result!.totalOutputRows,
        phases: result!.phases.map((p) => ({
          name: p.name,
          tables: p.tables.map((t) => ({
            source: t.sourceTable,
            target: t.targetTable,
            inputRows: t.inputRows,
            outputRows: t.outputRows,
            skippedRows: t.skippedRows,
            warnings: t.warnings,
          })),
        })),
        warnings: result!.warnings,
      },
    });
  } catch (err) {
    console.error('Mapping error:', err);
    return NextResponse.json(
      { error: `Mapping failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
