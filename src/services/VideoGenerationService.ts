import { VertexAI } from '@google-cloud/vertexai';
import { DesignBrief, ProductData, ImageMetadata } from '@/types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { webScraperService } from './WebScraperService';
import { logRequest, logResponse, logError } from '@/utils/logger';

/**
 * Service for generating videos using Vertex AI Veo (Nano Banana model)
 * 
 * Uses Veo 3.0 for high-quality editorial-style video generation with product
 * images as input for image-to-video generation, creating dynamic storytelling
 * content for commercial campaigns.
 * 
 * Now implements smart image selection using quality scores and metadata.
 */
export class VideoGenerationService {
  private vertexAI: VertexAI | null = null;
  private readonly outputDir: string;
  private readonly isConfigured: boolean;

  constructor() {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const isValidProject = project && project !== 'your_gcp_project_id';
    
    this.isConfigured = !!isValidProject;
    
    if (isValidProject) {
      this.vertexAI = new VertexAI({
        project,
        location: process.env.GOOGLE_CLOUD_REGION || 'us-central1',
      });
    }
    
    this.outputDir = path.join(process.cwd(), 'public', 'generated');
    this.ensureOutputDir();
  }

  /**
   * Ensures the output directory exists
   */
  private ensureOutputDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Creates a job-specific folder structure
   */
  private createJobFolder(jobId: string): string {
    const jobFolder = path.join(this.outputDir, jobId);
    if (!fs.existsSync(jobFolder)) {
      fs.mkdirSync(jobFolder, { recursive: true });
    }
    return jobFolder;
  }

  /**
   * Selects the best quality product image for video generation using metadata
   */
  private selectBestImageForVideo(productData: ProductData): { path: string; metadata?: ImageMetadata } | undefined {
    // Use metadata-based selection if available
    if (productData.imageMetadata && productData.imageMetadata.length > 0) {
      const bestImage = webScraperService.getBestImageForVideo(productData.imageMetadata);
      if (bestImage && fs.existsSync(bestImage.localPath)) {
        console.log(`Selected best image for video: ${bestImage.localPath}`);
        console.log(`  View type: ${bestImage.viewType}, Quality score: ${bestImage.qualityScore}`);
        console.log(`  Dimensions: ${bestImage.width}x${bestImage.height}`);
        return { path: bestImage.localPath, metadata: bestImage };
      }
    }
    
    // Fall back to first available local image
    if (productData.localImagePaths && productData.localImagePaths.length > 0) {
      const firstImage = productData.localImagePaths[0];
      if (fs.existsSync(firstImage)) {
        console.log(`Falling back to first product image for video: ${firstImage}`);
        return { path: firstImage };
      }
    }
    
    console.log('No product images available for video generation');
    return undefined;
  }

  /**
   * Generates an editorial video based on the design brief
   * 
   * Uses the provided source image (e.g., generated editorial image) as input for video generation.
   * Falls back to product images if no source image is provided.
   */
  async generateVideo(
    brief: DesignBrief,
    productData: ProductData,
    jobId: string,
    sourceImagePath?: string
  ): Promise<{ filePath: string; url: string; thumbnail?: string }> {
    const prompt = this.constructVideoPrompt(brief, productData);
    
    try {
      // Use provided source image (generated editorial image) or fall back to product images
      let productImagePath: string | undefined;
      
      if (sourceImagePath && fs.existsSync(sourceImagePath)) {
        console.log('Using generated editorial image as video input:', sourceImagePath);
        productImagePath = sourceImagePath;
      } else {
        // Fall back to best product image
        const selectedImage = this.selectBestImageForVideo(productData);
        productImagePath = selectedImage?.path;
        if (selectedImage?.metadata) {
          console.log('Image quality score:', selectedImage.metadata.qualityScore);
          console.log('Image view type:', selectedImage.metadata.viewType);
        }
      }
      
      console.log('========== Video Generation ==========');
      console.log('Product:', productData.name);
      console.log('Prompt:', prompt.substring(0, 200) + '...');
      console.log('Source image:', productImagePath || 'None');
      console.log('=======================================');
      
      // Generate video using Vertex AI Veo
      const videoData = await this.callVideoGenerationAPI(prompt, productImagePath);
      
      // Save video to job folder
      const jobFolder = this.createJobFolder(jobId);
      const timestamp = Date.now();
      const filename = `video-${timestamp}.mp4`;
      const filePath = path.join(jobFolder, filename);
      
      // Decode base64 video data
      const buffer = Buffer.from(videoData, 'base64');
      fs.writeFileSync(filePath, buffer);
      
      // Generate thumbnail from first frame (optional)
      const thumbnailUrl = await this.generateThumbnail(filePath);
      
      console.log('Video saved:', filename);
      
      return {
        filePath,
        url: `/generated/${jobId}/${filename}`,
        thumbnail: thumbnailUrl,
      };
    } catch (error) {
      console.error('Video generation failed:', error);
      throw new Error(`Failed to generate video: ${(error as Error).message}`);
    }
  }

  /**
   * Constructs an optimized prompt for editorial video generation with person using product
   * Note: This uses Vertex AI Veo 3.0 for video generation
   * Prompts are designed to be safe and avoid content filter issues
   */
  private constructVideoPrompt(brief: DesignBrief, productData: ProductData): string {
    const productName = productData.name || 'product';
    const brand = productData.brand || '';
    const visualStyle = brief.visualStyle || 'modern, clean';
    const mood = brief.mood || 'positive';
    
    // Safe, neutral prompt for commercial video
    const safePrompt = `Cinematic commercial advertisement video featuring a happy customer using ${productName}${brand ? ` by ${brand}` : ''}.

Scene: A customer demonstrates the product in a bright, modern setting. The product is clearly visible and shown in use. Clean, professional lighting. Smooth camera movement.

Style: ${visualStyle}
Atmosphere: ${mood}, professional, aspirational

Technical specifications:
- High-quality commercial cinematography
- Clean product demonstration
- Professional studio or lifestyle setting
- Smooth camera motion
- Bright, appealing lighting`;

    return safePrompt;
  }

  /**
   * Calls the Vertex AI Veo API (Nano Banana) to generate a video
   */
  private async callVideoGenerationAPI(prompt: string, productImagePath?: string): Promise<string> {
    // If not configured, use placeholder
    if (!this.isConfigured || !this.vertexAI) {
      console.warn('Vertex AI not configured, using placeholder video');
      return this.getPlaceholderVideo();
    }

    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credPath || !fs.existsSync(credPath)) {
      console.warn('Credentials file not found, using placeholder video');
      return this.getPlaceholderVideo();
    }

    try {
      const project = process.env.GOOGLE_CLOUD_PROJECT;
      const location = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
      // Use Veo 3.0 model for video generation (upgraded from Veo 2.0)
      const model = 'veo-3.0-generate-preview';
      
      const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;
      
      // Get access token
      const { GoogleAuth } = require('google-auth-library');
      const auth = new GoogleAuth({
        keyFilename: credPath,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();
      
      // Build request body
      const instance: { prompt: string; image?: { bytesBase64Encoded: string; mimeType: string } } = {
        prompt: prompt,
      };

      // Add product image for image-to-video if available
      if (productImagePath && fs.existsSync(productImagePath)) {
        const imageBuffer = fs.readFileSync(productImagePath);
        
        // Determine mime type from file extension
        const ext = path.extname(productImagePath).toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.webp') mimeType = 'image/webp';
        else if (ext === '.gif') mimeType = 'image/gif';
        
        instance.image = {
          bytesBase64Encoded: imageBuffer.toString('base64'),
          mimeType: mimeType,
        };
        console.log('Including product image for image-to-video generation, mimeType:', mimeType);
      }

      const requestBody = {
        instances: [instance],
        parameters: {
          aspectRatio: '16:9',
          durationSeconds: 8, // Veo 3.0 supports 4, 6, or 8 seconds for image-to-video
          sampleCount: 1,
        },
      };

      logRequest('Vertex AI Veo 3.0', 'generateVideo', {
        endpoint,
        model,
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 300),
        hasProductImage: !!instance.image,
        productImageSize: instance.image ? `${Math.round(instance.image.bytesBase64Encoded.length / 1024)}KB` : null,
        parameters: requestBody.parameters,
      });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logError('Vertex AI Veo 3.0', 'generateVideo', new Error(`${response.status} - ${errorText}`), {
          status: response.status,
          statusText: response.statusText,
        });
        console.warn('Veo API error, using placeholder video');
        return this.getPlaceholderVideo();
      }

      const result = await response.json();
      
      logResponse('Vertex AI Veo 3.0', 'generateVideo', {
        status: response.status,
        statusText: response.statusText,
        isLongRunning: !!result.name,
        operationName: result.name,
        hasPredictions: !!result.predictions,
        videoDataSize: result.predictions?.[0]?.bytesBase64Encoded 
          ? `${Math.round(result.predictions[0].bytesBase64Encoded.length / 1024)}KB`
          : null,
      });
      
      // Handle long-running operation
      if (result.name) {
        // Poll for completion
        const videoData = await this.pollVideoOperation(result.name, accessToken.token);
        return videoData;
      }
      
      // Direct response
      if (result.predictions && result.predictions[0] && result.predictions[0].bytesBase64Encoded) {
        return result.predictions[0].bytesBase64Encoded;
      }
      
      console.warn('No video data in response, using placeholder');
      return this.getPlaceholderVideo();
    } catch (error) {
      logError('Vertex AI Veo 3.0', 'generateVideo', error);
      console.warn('Using placeholder video');
      return this.getPlaceholderVideo();
    }
  }

  /**
   * Polls a long-running video generation operation
   */
  private async pollVideoOperation(operationName: string, accessToken: string): Promise<string> {
    const maxAttempts = 60; // 5 minutes max
    const pollInterval = 5000; // 5 seconds
    
    // Extract project, location and model from operation name
    // Format: projects/{PROJECT}/locations/{LOCATION}/publishers/google/models/{MODEL}/operations/{OP_ID}
    const matches = operationName.match(/projects\/([^\/]+)\/locations\/([^\/]+)\/publishers\/google\/models\/([^\/]+)/);
    if (!matches) {
      throw new Error(`Invalid operation name format: ${operationName}`);
    }
    
    const [, project, location, model] = matches;
    const fetchEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.sleep(pollInterval);
      
      console.log(`Polling video generation status... (attempt ${attempt + 1}/${maxAttempts})`);
      
      const response = await fetch(fetchEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operationName: operationName,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Poll error:', errorText);
        throw new Error(`Failed to check operation status: ${response.status}`);
      }

      const result = await response.json();
      
      console.log('Poll result done:', result.done);
      
      if (result.done) {
        if (result.error) {
          throw new Error(`Video generation failed: ${result.error.message}`);
        }
        
        // Check for video data in response - API returns 'videos' array
        const videos = result.response?.videos;
        if (videos && videos.length > 0) {
          const video = videos[0];
          // Return base64 encoded video or download from GCS
          if (video.bytesBase64Encoded) {
            console.log('Video generation complete - received base64 data');
            return video.bytesBase64Encoded;
          }
          if (video.gcsUri) {
            console.log('Video generation complete - downloading from GCS:', video.gcsUri);
            return await this.downloadFromGCS(video.gcsUri, accessToken);
          }
        }
        
        // Fallback to predictions format (older API)
        if (result.response?.predictions?.[0]?.bytesBase64Encoded) {
          return result.response.predictions[0].bytesBase64Encoded;
        }
        
        console.error('No video data in completed operation:', JSON.stringify(result, null, 2));
        throw new Error('No video data in completed operation');
      }
      
      console.log(`Video generation in progress... (attempt ${attempt + 1}/${maxAttempts})`);
    }
    
    throw new Error('Video generation timed out');
  }

  /**
   * Downloads a video from Google Cloud Storage
   */
  private async downloadFromGCS(gcsUri: string, accessToken: string): Promise<string> {
    // Extract bucket and object path from gs://bucket/path format
    const match = gcsUri.match(/gs:\/\/([^\/]+)\/(.+)/);
    if (!match) {
      throw new Error(`Invalid GCS URI: ${gcsUri}`);
    }
    
    const [, bucket, objectPath] = match;
    const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download video from GCS: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  }

  /**
   * Generates a thumbnail from the video
   */
  private async generateThumbnail(videoPath: string): Promise<string | undefined> {
    // For now, return undefined - thumbnail generation would require ffmpeg
    // In production, you'd use fluent-ffmpeg or similar
    return undefined;
  }

  /**
   * Returns a placeholder video for development
   */
  private getPlaceholderVideo(): string {
    // Create a minimal valid MP4 placeholder
    // This is a tiny valid MP4 file (essentially empty but valid)
    // In production, you'd generate an actual placeholder video
    console.log('Generating placeholder video for development...');
    
    // Return a simple placeholder - we'll create an actual video file
    const placeholderPath = path.join(this.outputDir, 'placeholder-video.mp4');
    
    // Check if placeholder already exists
    if (fs.existsSync(placeholderPath)) {
      return fs.readFileSync(placeholderPath).toString('base64');
    }
    
    // For development, return empty string which will be handled gracefully
    // In production, you'd have a real placeholder video file
    return '';
  }

  /**
   * Generates multiple videos
   */
  async generateMultipleVideos(
    brief: DesignBrief,
    productData: ProductData,
    count: number = 1
  ): Promise<Array<{ filePath: string; url: string; thumbnail?: string }>> {
    const results: Array<{ filePath: string; url: string; thumbnail?: string }> = [];
    const jobId = uuidv4();
    
    for (let i = 0; i < count; i++) {
      try {
        console.log(`Generating video ${i + 1} of ${count}...`);
        const result = await this.generateVideo(brief, productData, jobId);
        results.push(result);
      } catch (error) {
        console.error(`Failed to generate video ${i + 1}:`, error);
        // Continue with other videos
      }
    }
    
    return results;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const videoGenerationService = new VideoGenerationService();
