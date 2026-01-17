import { VertexAI } from '@google-cloud/vertexai';
import { DesignBrief, ProductData, ImageMetadata } from '@/types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { webScraperService } from './WebScraperService';
import { logRequest, logResponse, logError } from '@/utils/logger';

/**
 * Service for generating images using Vertex AI Gemini 2.5 Flash Image
 * 
 * Uses Gemini 2.5 Flash Image for high-quality editorial-style image generation
 * with product images as reference input for consistent product representation.
 * 
 * Implements smart image selection using quality scores and metadata.
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
   * Copies input image to job folder
   */
  private copyInputImage(sourcePath: string, jobId: string): string {
    const jobFolder = this.createJobFolder(jobId);
    const ext = path.extname(sourcePath);
    const destPath = path.join(jobFolder, `input${ext}`);
    fs.copyFileSync(sourcePath, destPath);
    console.log(`Copied input image to: ${destPath}`);
    return destPath;
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
   * Cleans up crawled product images after successful generation
   * Call this after all asset generation (images and videos) is complete
   */
  public async cleanupCrawledImages(productData: ProductData): Promise<void> {
    //return;
    if (!productData.localImagePaths || productData.localImagePaths.length === 0) {
      return;
    }

    console.log(`Cleaning up ${productData.localImagePaths.length} crawled images...`);
    
    // Add longer delay to ensure all file handles are released (especially Sharp)
    await this.sleep(3000);
    
    for (const imagePath of productData.localImagePaths) {
      let retries = 5;
      let deleted = false;
      
      while (retries > 0 && !deleted) {
        try {
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
            console.log(`  ✓ Deleted: ${path.basename(imagePath)}`);
            deleted = true;
          } else {
            deleted = true; // File doesn't exist, consider it deleted
          }
        } catch (error) {
          retries--;
          if (retries > 0) {
            // Exponential backoff: 1s, 2s, 3s, 4s, 5s
            const delay = (6 - retries) * 1000;
            await this.sleep(delay);
          } else {
            // Skip files that are locked - they'll be cleaned up later
            console.log(`  ⚠ Skipped (file locked): ${path.basename(imagePath)}`);
          }
        }
      }
    }
    
    console.log('Crawled images cleanup completed');
  }

  /**
   * Sleep utility for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generates an editorial image based on the design brief and product images
   * 
   * Uses Gemini 2.5 Flash Image for all image generation.
   */
  async generateImage(
    brief: DesignBrief,
    productData: ProductData,
    jobId: string
  ): Promise<{ filePath: string; url: string; inputImagePath?: string }> {
    try {
      // Select the best quality product image for reference
      const selectedImage = this.selectBestProductImage(productData);
      const productImagePath = selectedImage?.path;
      let inputImagePath: string | undefined;
      
      // Copy input image to job folder if available
      if (productImagePath) {
        inputImagePath = this.copyInputImage(productImagePath, jobId);
      }
      
      // Use Gemini 2.5 Flash Image for image generation
      const prompt = this.constructImagePrompt(brief, productData);
      console.log('Using Gemini 2.5 Flash Image API for image generation');
      const imageData = await this.callImageGenerationAPI(prompt, productImagePath);
      
      // Save image to job folder
      const jobFolder = this.createJobFolder(jobId);
      const timestamp = Date.now();
      const filename = `output-${timestamp}.png`;
      const filePath = path.join(jobFolder, filename);
      
      // Decode base64 image data
      const buffer = Buffer.from(imageData, 'base64');
      
      // Check if it's an SVG (placeholder) and convert to PNG
      const isSvg = buffer.toString('utf8', 0, 100).includes('<svg');
      if (isSvg) {
        // Convert SVG to PNG using sharp with high quality at 3072x3072
        await sharp(buffer)
          .resize(3072, 3072)
          .png({ quality: 100, compressionLevel: 6 })
          .toFile(filePath);
      } else {
        // Use Imagen 4 AI Upscale for high-quality 3x upscaling (1024 -> 3072)
        // This preserves details much better than algorithmic upscaling
        console.log('Using Imagen 4 AI Upscale for high-quality resolution enhancement...');
        try {
          const upscaledImageData = await this.callImagen4UpscaleAPI(imageData, 'x3');
          const upscaledBuffer = Buffer.from(upscaledImageData, 'base64');
          fs.writeFileSync(filePath, upscaledBuffer);
          console.log('  ✓ AI upscaling complete: 1024x1024 → 3072x3072');
        } catch (upscaleError) {
          console.warn('  ⚠ AI upscaling failed, falling back to Sharp Lanczos3:', (upscaleError as Error).message);
          // Fallback to Sharp if Imagen Upscale fails
          await sharp(buffer)
            .resize(3072, 3072, {
              kernel: sharp.kernel.lanczos3,
              fit: 'cover',
              position: 'center'
            })
            .png({ quality: 100, compressionLevel: 6 })
            .toFile(filePath);
        }
      }
      
      // Add text overlay using sharp
      const finalPath = await this.addTextOverlay(filePath, brief, jobId);
      
      // Force cleanup to release file handles
      if (global.gc) {
        global.gc();
      }
      
      return {
        filePath: finalPath,
        url: `/generated/${jobId}/${path.basename(finalPath)}`,
        inputImagePath,
      };
    } catch (error) {
      console.error('Image generation failed:', error);
      throw new Error(`Failed to generate image: ${(error as Error).message}`);
    }
  }

  /**
   * Extracts color and style information from product data
   * This helps create explicit color descriptions in the prompt
   */
  private extractProductColorInfo(productData: ProductData): string {
    const name = productData.name || '';
    const description = productData.description || '';
    const category = productData.category || 'product';
    
    // Try to extract color from name or description
    const combinedText = `${name} ${description}`.toLowerCase();
    
    // Common color keywords to look for
    const colorKeywords = [
      'olive', 'green', 'khaki', 'military green', 'sage',
      'navy', 'blue', 'dark blue', 'midnight',
      'black', 'charcoal', 'grey', 'gray',
      'white', 'cream', 'beige', 'tan',
      'brown', 'camel', 'cognac',
      'red', 'burgundy', 'maroon',
      'yellow', 'mustard', 'gold'
    ];
    
    const foundColors: string[] = [];
    for (const color of colorKeywords) {
      if (combinedText.includes(color)) {
        foundColors.push(color);
      }
    }
    
    // Build descriptive string
    let description_text = productData.name;
    if (foundColors.length > 0) {
      // Use detected colors
      const colorPart = foundColors.join(' and ');
      description_text = `${colorPart} ${category}`;
    }
    
    // Clean up and return
    return description_text || 'product shown in reference image';
  }

  /**
   * Constructs an optimized prompt for editorial image generation with person using product
   */
  private constructImagePrompt(brief: DesignBrief, productData: ProductData): string {
    // If we have the full editorial brief JSON, format it with main_prompt
    if (brief.editorialBrief) {
      console.log('✅ Using FULL EDITORIAL BRIEF JSON for image generation');
      
      // Extract color/style info from product data
      const productInfo = this.extractProductColorInfo(productData);
      console.log(`📦 Product Info: ${productInfo}`);
      
      // CRITICAL: Product preservation instructions MUST come first with EXPLICIT color description
      const productPreservationHeader = `🔴🔴🔴 ABSOLUTE REQUIREMENT - PRODUCT IDENTITY 🔴🔴🔴

THE REFERENCE IMAGE SHOWS: ${productInfo}

YOU MUST GENERATE: ${productInfo} (EXACT SAME)

CRITICAL RULES:
1. EXACT COLOR MATCH REQUIRED
   - Look at the reference image carefully
   - Match the EXACT colors you see: ${productInfo}
   - Do NOT change hues, shades, or tones
   - Do NOT make it darker, lighter, or different
   - EXAMPLE: If reference = olive green → output = olive green (NOT navy, NOT black, NOT dark green)

2. EXACT DESIGN MATCH REQUIRED  
   - Same style, cut, features from reference
   - Same logos, patches, zippers visible in reference
   - Do NOT simplify or modify design

3. YOUR ONLY CREATIVE FREEDOM
   - Scene background and environment
   - Lighting and atmosphere (but colors stay same)
   - Person/model pose and expression
   - Camera angle

⚠️ VALIDATION CHECKPOINT: Does my output product match "${productInfo}" exactly? YES/NO
⚠️ If NO → Go back and match the reference image colors exactly

---
3. DESIGN LOCK: Product design elements are NON-NEGOTIABLE
   - Keep exact same style, cut, features
   - Preserve all logos, patches, zippers, pockets
   - Do NOT add or remove design elements

4. YOUR CREATIVE FREEDOM applies ONLY to:
   - Scene composition and environment
   - Lighting and atmosphere
   - Person/model (but NOT the product they're wearing)
   - Camera angle and framing

5. VALIDATION: Before generating, confirm:
   ✓ Am I using the EXACT product from reference?
   ✓ Are the colors EXACTLY matching?
   ✓ Have I kept ALL design details intact?

⚠️  FAILURE TO FOLLOW THESE RULES = REJECTION

---

Now, create the editorial image following the brief below:`;
      
      // Main prompt from image-prompt.json
      const mainPrompt = "You are an expert editorial art director, fashion brand strategist, and visual storyteller. Help me create editorial image following json structure below";
      
      // Convert the editorial brief to a clean JSON string
      const jsonString = JSON.stringify(brief.editorialBrief, null, 2);
      
      // Combine: product rules + main_prompt + JSON
      const fullPrompt = `${productPreservationHeader}

${mainPrompt}

${jsonString}`;

      return fullPrompt;
    }
    
    // Fallback to simple prompt if no editorial brief
    console.warn('⚠️  No editorial brief JSON found, using fallback simple prompt');
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
- Ultra high resolution, 3072 x 3072 for maximum editorial quality
- Professional commercial advertising quality
- Sharp details, no compression artifacts
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
   * Calls the Vertex AI Gemini 2.5 Flash Image API to generate an image
   * Uses the generateContent endpoint with responseModalities: ['IMAGE']
   */
  private async callImageGenerationAPI(prompt: string, productImagePath?: string): Promise<string> {
    // If not configured or in development, use placeholder
    if (!this.isConfigured || !this.vertexAI) {
      console.warn('Vertex AI not configured, using placeholder image');
      return this.getPlaceholderImage();
    }

    // Debug: Log configuration
    console.log('Gemini 2.5 Flash Image Configuration:');
    console.log('  Project:', process.env.GOOGLE_CLOUD_PROJECT);
    console.log('  Region:', process.env.GOOGLE_CLOUD_REGION || 'us-central1');
    console.log('  Credentials file:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
    console.log('  Model: gemini-2.5-flash-image');
    if (productImagePath) {
      console.log('  Product image:', productImagePath);
    }
    
    // Check if credentials file exists
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath) {
      if (fs.existsSync(credPath)) {
        console.log('  Credentials file exists: YES');
      } else {
        console.error('  Credentials file exists: NO - File not found!');
        console.warn('Using placeholder image due to missing credentials file');
        return this.getPlaceholderImage();
      }
    }

    try {
      // Use Gemini 2.5 Flash Image for image generation via REST API
      const project = process.env.GOOGLE_CLOUD_PROJECT;
      const location = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
      const model = 'gemini-2.5-flash-image';
      
      const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
      
      // Get access token from service account
      const { GoogleAuth } = require('google-auth-library');
      const auth = new GoogleAuth({
        keyFilename: credPath,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();
      
      // Build request contents - include product image if available
      const contents: Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> = [];
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

      // Add product image as reference if available
      if (productImagePath && fs.existsSync(productImagePath)) {
        const imageBuffer = fs.readFileSync(productImagePath);
        const mimeType = productImagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: imageBuffer.toString('base64'),
          },
        });
        console.log('  Including product image as reference');
      }

      // Add the text prompt
      parts.push({ text: prompt });

      contents.push({
        role: 'user',
        parts: parts,
      });

      const requestBody = {
        contents: contents,
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          temperature: 0.6,  // Lower temperature for more precise, consistent generation
          topP: 0.95,
          topK: 40,
        },
      };
      console.log("============Prompt============");
      console.log(prompt);
      console.log("============End Prompt============");
      // Log the request
      logRequest('Gemini 2.5 Flash Image', 'generateImage', {
        endpoint,
        model,
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 300),
        hasProductImage: parts.length > 1,
        generationConfig: requestBody.generationConfig,
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
        logError('Gemini 2.5 Flash Image', 'generateImage', new Error(`${response.status} - ${errorText}`), {
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      
      // Log full response for debugging
      console.log('========== Gemini Full Response ==========');
      console.log(JSON.stringify(result, null, 2));
      console.log('==========================================');
      
      logResponse('Gemini 2.5 Flash Image', 'generateImage', {
        status: response.status,
        statusText: response.statusText,
        hasCandidates: !!result.candidates,
        candidatesCount: result.candidates?.length || 0,
      });
      
      // Extract base64 image from response
      // Gemini returns candidates[].content.parts[] with inlineData for images
      if (result.candidates && result.candidates[0]?.content?.parts) {
        for (const part of result.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            console.log('Gemini 2.5 Flash Image generation successful!');
            return part.inlineData.data;
          }
        }
      }
      
      console.log('ERROR: No image found in response structure:');
      console.log('  Has candidates:', !!result.candidates);
      console.log('  Candidates length:', result.candidates?.length || 0);
      console.log('  First candidate:', result.candidates?.[0] ? 'exists' : 'missing');
      console.log('  Has content:', !!result.candidates?.[0]?.content);
      console.log('  Has parts:', !!result.candidates?.[0]?.content?.parts);
      console.log('  Parts:', JSON.stringify(result.candidates?.[0]?.content?.parts, null, 2));
      
      throw new Error('No image data in Gemini response');
    } catch (error) {
      const err = error as Error;
      console.error('Gemini 2.5 Flash Image API error:', err.message);
      console.error('Full error:', error);
      
      // For development/testing, return a placeholder
      console.warn('Using placeholder image for development');
      return this.getPlaceholderImage();
    }
  }

  /**
   * Calls the Vertex AI Imagen 4 Upscale API for AI-based image upscaling
   * Supports x2, x3, x4 upscale factors
   * Maximum output: 17 megapixels (e.g., 1024 * 3 = 3072, which is ~9.4MP - well within limits)
   */
  private async callImagen4UpscaleAPI(imageBase64: string, upscaleFactor: 'x2' | 'x3' | 'x4' = 'x3'): Promise<string> {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    
    if (!credPath || !fs.existsSync(credPath)) {
      throw new Error('Credentials file not found for Imagen Upscale API');
    }

    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
    const model = 'imagen-4.0-upscale-preview';
    
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;
    
    console.log('Imagen 4 Upscale Configuration:');
    console.log('  Model:', model);
    console.log('  Upscale factor:', upscaleFactor);
    
    // Get access token from service account
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({
      keyFilename: credPath,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    const requestBody = {
      instances: [
        {
          prompt: 'Upscale this image while preserving all details, colors, and textures',
          image: {
            bytesBase64Encoded: imageBase64,
          },
        }
      ],
      parameters: {
        mode: 'upscale',
        upscaleConfig: {
          upscaleFactor: upscaleFactor,
        },
        outputOptions: {
          mimeType: 'image/png',
        },
      },
    };

    logRequest('Imagen 4 Upscale', 'upscaleImage', {
      endpoint,
      model,
      upscaleFactor,
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
      logError('Imagen 4 Upscale', 'upscaleImage', new Error(`${response.status} - ${errorText}`), {
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`Imagen Upscale API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    logResponse('Imagen 4 Upscale', 'upscaleImage', {
      status: response.status,
      hasPredictions: !!result.predictions,
      predictionsCount: result.predictions?.length || 0,
    });
    
    // Extract base64 image from response
    if (result.predictions && result.predictions[0]?.bytesBase64Encoded) {
      console.log('  ✓ Imagen 4 Upscale successful!');
      return result.predictions[0].bytesBase64Encoded;
    }
    
    throw new Error('No image data in Imagen Upscale response');
  }

  /**
   * Adds text overlay to the generated image using sharp
   */
  private async addTextOverlay(imagePath: string, brief: DesignBrief, jobId: string): Promise<string> {
    try {
      const image = sharp(imagePath);
      const metadata = await image.metadata();
      const width = metadata.width || 2048;
      const height = metadata.height || 2048;

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
        </svg>
      `;

      const jobFolder = this.createJobFolder(jobId);
      const outputFilename = `${uuidv4()}_overlay.png`;
      const outputPath = path.join(jobFolder, outputFilename);

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
    const width = 3072;
    const height = 3072;

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
    jobId: string,
    count: number = 3
  ): Promise<Array<{ filePath: string; url: string; inputImagePath?: string }>> {
    const results: Array<{ filePath: string; url: string; inputImagePath?: string }> = [];
    
    // Generate images sequentially to avoid rate limits
    for (let i = 0; i < count; i++) {
      try {
        const result = await this.generateImage(brief, productData, jobId);
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
