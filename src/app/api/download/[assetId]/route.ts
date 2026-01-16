import { NextRequest, NextResponse } from 'next/server';
import { ErrorResponse } from '@/types/api';
import { storageService } from '@/services/StorageService';
import * as fs from 'fs';

/**
 * GET /api/download/[assetId]
 * Downloads a generated asset
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    const { assetId } = params;

    if (!assetId) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'MISSING_ASSET_ID',
          message: 'Asset ID is required',
          retryable: false,
        },
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const file = storageService.getFile(assetId);

    if (!file) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'ASSET_NOT_FOUND',
          message: 'Asset not found',
          retryable: false,
        },
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Return the file as a download
    return new NextResponse(file.buffer, {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Content-Length': file.buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Download endpoint error:', error);
    
    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to download asset',
        retryable: true,
      },
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
