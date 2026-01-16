import { NextRequest, NextResponse } from 'next/server';
import { GenerateRequest, GenerateResponse, ErrorResponse } from '@/types/api';
import { webScraperService } from '@/services/WebScraperService';
import { llmService } from '@/services/LLMService';
import { imageGenerationService } from '@/services/ImageGenerationService';
import { videoGenerationService } from '@/services/VideoGenerationService';
import { storageService } from '@/services/StorageService';

/**
 * POST /api/generate
 * Initiates the asset generation pipeline
 */
export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();
    const { productUrl, options } = body;

    // Validate URL
    const validation = webScraperService.validateUrl(productUrl);
    if (!validation.valid) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INVALID_URL',
          message: validation.error || 'Invalid URL format',
          retryable: false,
        },
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Create job
    const job = storageService.createJob(productUrl);

    // Start async processing (don't await)
    processJob(job.id, productUrl, options).catch(error => {
      console.error('Job processing failed:', error);
      storageService.updateJob(job.id, {
        status: 'failed',
        error: error.message,
      });
    });

    // Return job ID immediately
    const response: GenerateResponse = {
      jobId: job.id,
      status: job.status,
    };

    return NextResponse.json(response, { status: 202 });
  } catch (error) {
    console.error('Generate endpoint error:', error);
    
    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to process request',
        retryable: true,
      },
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

/**
 * Processes a generation job asynchronously
 */
async function processJob(
  jobId: string,
  productUrl: string,
  options?: { includeVideo: boolean; imageCount: number }
) {
  const imageCount = options?.imageCount || 1;
  const includeVideo = options?.includeVideo ?? true; // Default to including video

  try {
    // Step 1: Scrape product page
    storageService.updateJob(jobId, {
      status: 'scraping',
      progress: 10,
      currentStep: 'Extracting product information...',
    });

    const productData = await webScraperService.scrapeProductPage(productUrl);

    storageService.updateJob(jobId, {
      productData,
      progress: 30,
    });

    // Step 2: Generate design brief
    storageService.updateJob(jobId, {
      status: 'generating_brief',
      progress: 40,
      currentStep: 'Creating design brief...',
    });

    const designBrief = await llmService.generateDesignBrief(productData);

    storageService.updateJob(jobId, {
      designBrief,
      progress: 60,
    });

    // Step 3: Generate images
    storageService.updateJob(jobId, {
      status: 'generating_assets',
      progress: 50,
      currentStep: 'Generating editorial images...',
    });

    const images = await imageGenerationService.generateMultipleImages(
      designBrief,
      productData,
      imageCount
    );

    // Create image asset records
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const asset = storageService.createAsset(
        jobId,
        'image',
        image.filePath,
        `${designBrief.productName} - Editorial ${i + 1}`,
        designBrief.messaging
      );
      storageService.addAssetToJob(jobId, asset);
    }

    // Step 4: Generate video (if requested)
    if (includeVideo) {
      storageService.updateJob(jobId, {
        status: 'generating_assets',
        progress: 75,
        currentStep: 'Generating editorial video...',
      });

      // Use the first generated image as the source for video generation
      const sourceImagePath = images.length > 0 ? images[0].filePath : undefined;

      const video = await videoGenerationService.generateVideo(
        designBrief,
        productData,
        sourceImagePath
      );

      const videoAsset = storageService.createAsset(
        jobId,
        'video',
        video.filePath,
        `${designBrief.productName} - Editorial Video`,
        designBrief.messaging
      );
      
      // Add thumbnail if available
      if (video.thumbnail) {
        videoAsset.thumbnail = video.thumbnail;
      }
      
      storageService.addAssetToJob(jobId, videoAsset);
    }

    // Clean up crawled images after all generation is complete
    imageGenerationService.cleanupCrawledImages(productData);

    // Complete job
    storageService.updateJob(jobId, {
      status: 'completed',
      progress: 100,
      currentStep: 'Complete',
      completedAt: new Date(),
    });
  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    storageService.updateJob(jobId, {
      status: 'failed',
      error: (error as Error).message,
    });
    throw error;
  }
}
