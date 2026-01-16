import OpenAI from 'openai';
import { ProductData, DesignBrief } from '@/types';

/**
 * Service for generating design briefs using OpenAI LLM
 */
export class LLMService {
  private openai: OpenAI | null = null;
  private readonly maxRetries = 2;
  private readonly retryDelay = 5000; // 5 seconds

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    // Only initialize OpenAI if we have a valid API key
    if (apiKey && apiKey !== 'your_openai_api_key_here') {
      this.openai = new OpenAI({ apiKey });
    }
  }

  /**
   * Generates a design brief from product data
   */
  async generateDesignBrief(productData: ProductData): Promise<DesignBrief> {
    // If no OpenAI client, use fallback immediately
    if (!this.openai) {
      console.warn('OpenAI API key not configured, using template-based brief generation');
      return this.generateFallbackBrief(productData);
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.attemptGenerateBrief(productData);
      } catch (error) {
        lastError = error as Error;
        
        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          break;
        }

        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay);
        }
      }
    }

    // If all retries failed, use fallback template
    console.warn('LLM API failed, using template-based brief generation');
    return this.generateFallbackBrief(productData);
  }

  /**
   * Attempts to generate a design brief via API
   */
  private async attemptGenerateBrief(productData: ProductData): Promise<DesignBrief> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }
    const prompt = this.constructPrompt(productData);

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `You are an expert creative director specializing in commercial advertising and editorial content. 
Your task is to create compelling design briefs for product advertisements.
Always respond with valid JSON matching the specified format.
Focus on creating visually striking, brand-safe, and commercially effective advertising concepts.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from LLM');
      }

      return this.parseResponse(content, productData.name);
    } catch (error) {
      const openAIError = error as { status?: number; code?: string };
      
      if (openAIError.status === 401) {
        throw new Error('Invalid OpenAI API key. Please check your configuration.');
      } else if (openAIError.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      } else if (openAIError.status === 500) {
        throw new Error('OpenAI service error. Please try again.');
      }
      
      throw error;
    }
  }

  /**
   * Constructs the prompt for design brief generation
   */
  private constructPrompt(productData: ProductData): string {
    const productInfo = [
      `Product Name: ${productData.name}`,
      productData.description ? `Description: ${productData.description}` : '',
      productData.category ? `Category: ${productData.category}` : '',
      productData.brand ? `Brand: ${productData.brand}` : '',
      productData.price ? `Price: ${productData.price}` : '',
    ].filter(Boolean).join('\n');

    return `Create an editorial design brief for the following product advertisement:

${productInfo}

Generate a creative design brief that includes:
1. Visual style direction (photography style, lighting, composition)
2. Messaging and copy suggestions (headline, tagline, body copy ideas)
3. Target audience description
4. Color palette recommendations (3-5 hex colors that complement the product)
5. Overall mood and atmosphere
6. Key product features to highlight
7. Call to action
8. A detailed image prompt for AI image generation (describe the ideal ad image in detail)

Respond with a JSON object in this exact format:
{
  "visualStyle": "string describing the visual direction",
  "messaging": "string with headline and key messaging",
  "targetAudience": "string describing the target demographic",
  "colorPalette": ["#hex1", "#hex2", "#hex3"],
  "mood": "string describing the emotional tone",
  "keyFeatures": ["feature1", "feature2", "feature3"],
  "callToAction": "string with the CTA",
  "imagePrompt": "detailed prompt for AI image generation"
}`;
  }

  /**
   * Parses the LLM response into a DesignBrief
   */
  private parseResponse(content: string, productName: string): DesignBrief {
    try {
      const parsed = JSON.parse(content);

      // Validate required fields
      const requiredFields = ['visualStyle', 'messaging', 'targetAudience', 'mood', 'imagePrompt'];
      for (const field of requiredFields) {
        if (!parsed[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Ensure colorPalette is an array
      if (!Array.isArray(parsed.colorPalette)) {
        parsed.colorPalette = ['#1a1a2e', '#16213e', '#0f3460', '#e94560', '#ffffff'];
      }

      // Ensure keyFeatures is an array
      if (!Array.isArray(parsed.keyFeatures)) {
        parsed.keyFeatures = [];
      }

      return {
        productName,
        visualStyle: parsed.visualStyle,
        messaging: parsed.messaging,
        targetAudience: parsed.targetAudience,
        colorPalette: parsed.colorPalette,
        mood: parsed.mood,
        keyFeatures: parsed.keyFeatures,
        callToAction: parsed.callToAction || 'Shop Now',
        imagePrompt: parsed.imagePrompt,
        videoPrompt: parsed.videoPrompt,
        generatedAt: new Date(),
      };
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      throw new Error('Failed to parse design brief from LLM response');
    }
  }

  /**
   * Generates a fallback template-based brief when LLM fails
   */
  private generateFallbackBrief(productData: ProductData): DesignBrief {
    const productName = productData.name;
    
    return {
      productName,
      visualStyle: 'Clean, modern product photography with soft natural lighting. Minimalist composition with the product as the hero element. High-end editorial aesthetic with subtle shadows and reflections.',
      messaging: `Discover ${productName} - Elevate Your Experience. Premium quality meets exceptional design.`,
      targetAudience: 'Style-conscious consumers aged 25-45 who appreciate quality and design. Urban professionals seeking premium products.',
      colorPalette: ['#1a1a2e', '#16213e', '#0f3460', '#e94560', '#ffffff'],
      mood: 'Sophisticated, aspirational, and contemporary. Conveys quality and attention to detail.',
      keyFeatures: productData.description 
        ? productData.description.split('.').slice(0, 3).map(s => s.trim()).filter(Boolean)
        : ['Premium Quality', 'Modern Design', 'Exceptional Value'],
      callToAction: 'Shop Now',
      imagePrompt: `High-end commercial product photography of ${productName}. Clean white or gradient background. Professional studio lighting with soft shadows. Product centered in frame with elegant composition. Magazine-quality editorial style. 8K resolution, photorealistic.`,
      generatedAt: new Date(),
    };
  }

  /**
   * Checks if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    const openAIError = error as { status?: number; code?: string };
    
    // Retry on rate limits and server errors
    if (openAIError.status === 429 || openAIError.status === 500) {
      return true;
    }
    
    // Don't retry on auth errors
    if (openAIError.status === 401) {
      return false;
    }
    
    // Retry on network errors
    const networkError = error as { code?: string };
    if (networkError.code === 'ECONNRESET' || networkError.code === 'ETIMEDOUT') {
      return true;
    }
    
    return true; // Default to retrying
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const llmService = new LLMService();
