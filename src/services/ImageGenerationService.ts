import { VertexAI } from '@google-cloud/vertexai';
import { DesignBrief, ProductData, ImageMetadata } from '@/types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { webScraperService } from './WebScraperService';
import { logRequest, logResponse, logError } from '@/utils/logger';

/**
 * Service for generating images using Vertex AI Imagen (Nano Banana model)
 * 
 * Uses Imagen 3 for high-quality editorial-style image generation with product
 * images as reference input for consistent product representation.
 * 
 * Now implements smart image selection using quality scores and metadata.
 */
export class ImageGenerationService {
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
   * Selects the best quality product image for reference using metadata
   */
  private selectBestProductImage(productData: ProductData): { path: string; metadata?: ImageMetadata } | undefined {
    // Use metadata-based selection if available
    if (productData.imageMetadata && productData.imageMetadata.length > 0) {
      const bestImage = webScraperService.getBestMainImage(productData.imageMetadata);
      if (bestImage && fs.existsSync(bestImage.localPath)) {
        console.log(`Selected best product image: ${bestImage.localPath}`);
        console.log(`  View type: ${bestImage.viewType}, Quality score: ${bestImage.qualityScore}`);
        console.log(`  Dimensions: ${bestImage.width}x${bestImage.height}, Is main: ${bestImage.isMainProductImage}`);
        return { path: bestImage.localPath, metadata: bestImage };
      }
    }
    
    // Fall back to first available local image
    if (productData.localImagePaths && productData.localImagePaths.length > 0) {
      const firstImage = productData.localImagePaths[0];
      if (fs.existsSync(firstImage)) {
        console.log(`Falling back to first product image: ${firstImage}`);
        return { path: firstImage };
      }
    }
    
    console.log('No product images available for reference');
    return undefined;
  }

  /**
   * Generates an editorial image based on the design brief and product images
   * 
   * Uses the best quality product image as reference for accurate product representation.
   */
  async generateImage(
    brief: DesignBrief,
    productData: ProductData
  ): Promise<{ filePath: string; url: string }> {
    const prompt = this.constructImagePrompt(brief, productData);
    
    try {
      // Select the best quality product image for reference
      const selectedImage = this.selectBestProductImage(productData);
      const productImagePath = selectedImage?.path;
      
      // Generate image using Vertex AI with product image as reference
      const imageData = await this.callImageGenerationAPI(prompt, productImagePath);
      
      // Save image to disk
      const filename = `${uuidv4()}.png`;
      const filePath = path.join(this.outputDir, filename);
      
      // Decode base64 image data
      const buffer = Buffer.from(imageData, 'base64');
      
      // Check if it's an SVG (placeholder) and convert to PNG
      const isSvg = buffer.toString('utf8', 0, 100).includes('<svg');
      if (isSvg) {
        // Convert SVG to PNG using sharp
        await sharp(buffer)
          .resize(1024, 1024)
          .png()
          .toFile(filePath);
      } else {
        // Write regular image data
        fs.writeFileSync(filePath, buffer);
      }
      
      // Add text overlay using sharp
      const finalPath = await this.addTextOverlay(filePath, brief);
      
      return {
        filePath: finalPath,
        url: `/generated/${path.basename(finalPath)}`,
      };
    } catch (error) {
      console.error('Image generation failed:', error);
      throw new Error(`Failed to generate image: ${(error as Error).message}`);
    }
  }

  /**
   * Constructs an optimized prompt for editorial image generation with person using product
   */
  private constructImagePrompt(brief: DesignBrief, productData: ProductData): string {
    const basePrompt = brief.imagePrompt;
    
    // Enhance the prompt with editorial requirements emphasizing person using product
    const enhancedPrompt = `${basePrompt}

EDITORIAL REQUIREMENTS (CRITICAL):
- MUST feature a person/human using, wearing, or interacting with the product
- Show the product in active use by the person (e.g., person trail running with shoes, person using tech device, person wearing clothing)
- Product must be visible and recognizable while being used by the person
- Editorial lifestyle scenario, NOT just product photography

Style: ${brief.visualStyle}
Mood: ${brief.mood}
Product: ${productData.name}
${productData.brand ? `Brand: ${productData.brand}` : ''}

Technical Requirements:
- High resolution, 1024x1024 minimum
- Commercial advertising quality
- Editorial magazine photography style
- Person as the subject with product in use
- Lifestyle scenario with authentic human interaction
- Clean, professional composition
- Suitable for commercial use
- No text in the image (text will be added separately)

CRITICAL: The image MUST show a person using or interacting with this product in a real-world lifestyle context.`;

    return enhancedPrompt;
  }

  /**
   * Calls the Vertex AI API to generate an image (with optional product image reference)
   */
  private async callImageGenerationAPI(prompt: string, productImagePath?: string): Promise<string> {
    // If not configured or in development, use placeholder
    if (!this.isConfigured || !this.vertexAI) {
      console.warn('Vertex AI not configured, using placeholder image');
      return this.getPlaceholderImage();
    }

    // Debug: Log configuration
    console.log('Vertex AI Configuration:');
    console.log('  Project:', process.env.GOOGLE_CLOUD_PROJECT);
    console.log('  Region:', process.env.GOOGLE_CLOUD_REGION || 'us-central1');
    console.log('  Credentials file:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
    console.log('  Model: imagen-3.0-generate-001');
    if (productImagePath) {
      console.log('  Product image:', productImagePath);
    }
    
    // Check if credentials file exists
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath) {
      const fs = require('fs');
      if (fs.existsSync(credPath)) {
        console.log('  Credentials file exists: YES');
      } else {
        console.error('  Credentials file exists: NO - File not found!');
        console.warn('Using placeholder image due to missing credentials file');
        return this.getPlaceholderImage();
      }
    }

    try {
      // Use Imagen 3 for image generation via REST API
      const project = process.env.GOOGLE_CLOUD_PROJECT;
      const location = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
      const model = 'imagen-3.0-generate-001';
      
      const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;
      
      // Get access token from service account
      const { GoogleAuth } = require('google-auth-library');
      const auth = new GoogleAuth({
        keyFilename: credPath,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();
      
      // Build request body - include product image if available
      const fs = require('fs');
      const instance: { prompt: string; image?: { bytesBase64Encoded: string } } = {
        prompt: prompt,
      };

      // Add product image as reference if available
      if (productImagePath && fs.existsSync(productImagePath)) {
        const imageBuffer = fs.readFileSync(productImagePath);
        instance.image = {
          bytesBase64Encoded: imageBuffer.toString('base64'),
        };
        console.log('  Including product image as reference');
      }

      const requestBody = {
        instances: [instance],
        parameters: {
          sampleCount: 1,
          aspectRatio: '1:1',
          safetyFilterLevel: 'block_some',
          personGeneration: 'allow_adult',
        },
      };

      // Log the request (with base64 truncation)
      logRequest('Vertex AI Imagen 3', 'generateImage', {
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
        logError('Vertex AI Imagen 3', 'generateImage', new Error(`${response.status} - ${errorText}`), {
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`Imagen API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      
      logResponse('Vertex AI Imagen 3', 'generateImage', {
        status: response.status,
        statusText: response.statusText,
        hasPredictions: !!result.predictions,
        predictionsCount: result.predictions?.length || 0,
        imageDataSize: result.predictions?.[0]?.bytesBase64Encoded 
          ? `${Math.round(result.predictions[0].bytesBase64Encoded.length / 1024)}KB`
          : null,
      });
      
      // Extract base64 image from response
      if (result.predictions && result.predictions[0] && result.predictions[0].bytesBase64Encoded) {
        return result.predictions[0].bytesBase64Encoded;
      }
      
      throw new Error('No image data in Imagen response');
    } catch (error) {
      const err = error as Error;
      console.error('Vertex AI API error:', err.message);
      console.error('Full error:', error);
      
      // For development/testing, return a placeholder
      console.warn('Using placeholder image for development');
      return this.getPlaceholderImage();
    }
  }

  /**
   * Adds text overlay to the generated image using sharp
   */
  private async addTextOverlay(imagePath: string, brief: DesignBrief): Promise<string> {
    try {
      const image = sharp(imagePath);
      const metadata = await image.metadata();
      const width = metadata.width || 1024;
      const height = metadata.height || 1024;

      // Create SVG text overlay
      const productName = this.escapeXml(brief.productName);
      const callToAction = this.escapeXml(brief.callToAction);
      const accentColor = brief.colorPalette[3] || '#e94560';

      const svgOverlay = `
        <svg width="${width}" height="${height}">
          <defs>
            <linearGradient id="textBg" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style="stop-color:rgb(0,0,0);stop-opacity:0" />
              <stop offset="100%" style="stop-color:rgb(0,0,0);stop-opacity:0.7" />
            </linearGradient>
          </defs>
          <rect x="0" y="${height * 0.75}" width="${width}" height="${height * 0.25}" fill="url(#textBg)"/>
          <text x="${width / 2}" y="${height - 80}" 
                font-family="Arial, sans-serif" 
                font-size="48" 
                font-weight="bold" 
                fill="white" 
                text-anchor="middle">${productName}</text>
          <text x="${width / 2}" y="${height - 40}" 
                font-family="Arial, sans-serif" 
                font-size="24" 
                font-weight="bold" 
                fill="${accentColor}" 
                text-anchor="middle">${callToAction}</text>
        </svg>
      `;

      const outputFilename = `${uuidv4()}_overlay.png`;
      const outputPath = path.join(this.outputDir, outputFilename);

      await image
        .composite([
          {
            input: Buffer.from(svgOverlay),
            top: 0,
            left: 0,
          },
        ])
        .toFile(outputPath);

      // Clean up original file
      if (outputPath !== imagePath) {
        fs.unlinkSync(imagePath);
      }

      return outputPath;
    } catch (error) {
      console.error('Failed to add text overlay:', error);
      // Return original image if overlay fails
      return imagePath;
    }
  }

  /**
   * Escapes XML special characters for SVG
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Returns a placeholder image for development
   */
  private getPlaceholderImage(): string {
    const width = 1024;
    const height = 1024;

    // Create SVG placeholder
    const svg = `
      <svg width="${width}" height="${height}">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#1a1a2e;stop-opacity:1" />
            <stop offset="50%" style="stop-color:#16213e;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#0f3460;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)"/>
        <text x="50%" y="50%" font-family="Arial" font-size="48" font-weight="bold" fill="white" text-anchor="middle" dy="0">Generated Image</text>
        <text x="50%" y="58%" font-family="Arial" font-size="24" fill="#888888" text-anchor="middle">Placeholder for Development</text>
      </svg>
    `;

    return Buffer.from(svg).toString('base64');
  }

  /**
   * Generates multiple images with variations
   */
  async generateMultipleImages(
    brief: DesignBrief,
    productData: ProductData,
    count: number = 3
  ): Promise<Array<{ filePath: string; url: string }>> {
    const results: Array<{ filePath: string; url: string }> = [];
    
    // Generate images sequentially to avoid rate limits
    for (let i = 0; i < count; i++) {
      try {
        const result = await this.generateImage(brief, productData);
        results.push(result);
      } catch (error) {
        console.error(`Failed to generate image ${i + 1}:`, error);
        // Continue with remaining images
      }
    }
    
    if (results.length === 0) {
      throw new Error('Failed to generate any images');
    }
    
    return results;
  }
}

// Export singleton instance
export const imageGenerationService = new ImageGenerationService();
