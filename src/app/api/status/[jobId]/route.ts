import { NextRequest, NextResponse } from 'next/server';
import { StatusResponse, ErrorResponse } from '@/types/api';
import { storageService } from '@/services/StorageService';

/**
 * GET /api/status/[jobId]
 * Returns the current status of a generation job
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params;

    if (!jobId) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'MISSING_JOB_ID',
          message: 'Job ID is required',
          retryable: false,
        },
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const job = storageService.getJob(jobId);

    if (!job) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Job not found',
          retryable: false,
        },
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: StatusResponse = {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      currentStep: job.currentStep,
      productData: job.productData,
      designBrief: job.designBrief,
      assets: job.assets,
      error: job.error,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Status endpoint error:', error);
    
    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve job status',
        retryable: true,
      },
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
