import OpenAI from 'openai';
import { ProductData, DesignBrief } from '@/types';
import { logRequest, logResponse, logError } from '@/utils/logger';

/**
 * Service for generating design briefs using OpenAI LLM
 */
export class LLMService {
  private openai: OpenAI;
  private readonly maxRetries = 2;
  private readonly retryDelay = 5000; // 5 seconds

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generates a design brief from product data
   */
  async generateDesignBrief(productData: ProductData): Promise<DesignBrief> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.attemptGenerateBrief(productData);
      } catch (error) {
        lastError = error as Error;
        
        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw error;
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
    const prompt = this.constructPrompt(productData);

    logRequest('OpenAI LLM', 'generateDesignBrief', {
      model: 'gpt-4-turbo',
      temperature: 0.8,
      max_tokens: 2500,
      promptLength: prompt.length,
      productName: productData.name,
    });

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: `You are an expert creative director specializing in EDITORIAL commercial advertising featuring real people using products.

Your task is to transform product information into compelling EDITORIAL advertising concepts that show PEOPLE using or interacting with the product in lifestyle scenarios.

KEY REQUIREMENTS:
- ALWAYS include people/humans using, wearing, or interacting with the product
- Create lifestyle/editorial scenarios (NOT just product photography)
- Examples: person trail running with shoes, person using tech gadget, person wearing fashion item, person cooking with appliance
- Focus on human experience, emotion, and storytelling
- Show the product in real-world use contexts
- Transform product features into human benefits and experiences

Always respond with valid JSON matching the specified format.
Focus on creating visually striking, emotionally engaging, and commercially effective editorial advertising concepts with people.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.8,
        max_tokens: 2500,
        response_format: { type: 'json_object' },
      });

      logResponse('OpenAI LLM', 'generateDesignBrief', {
        id: response.id,
        model: response.model,
        usage: response.usage,
        finishReason: response.choices[0]?.finish_reason,
        contentLength: response.choices[0]?.message?.content?.length || 0,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from LLM');
      }

      return this.parseResponse(content, productData.name);
    } catch (error) {
      logError('OpenAI LLM', 'generateDesignBrief', error, { productName: productData.name });
      
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

    return `Create an EDITORIAL design brief for the following product advertisement:

${productInfo}

CRITICAL: This must be an EDITORIAL LIFESTYLE concept featuring a PERSON/HUMAN using or interacting with the product, NOT just product photography.

Generate a creative EDITORIAL design brief that shows people using the product in real-world scenarios:

1. EDITORIAL CONCEPT & STORYTELLING (MUST include person using product):
   - Describe a compelling scenario of a person using this product
   - Examples: "Person trail running through mountain terrain with [product]", "Person using [product] while working from cafe", "Person wearing [product] at outdoor festival"
   - Focus on human experience, emotion, and lifestyle context
   - Transform product features into human benefits and real-world use cases

2. VISUAL STYLE & SCENE COMPOSITION (with person):
   - Photography style showing person interacting with product
   - Lighting that highlights both person and product
   - Composition featuring person as subject with product in use
   - Editorial magazine-quality aesthetic

3. MESSAGING (human-focused, not just product specs):
   - Headline about the human experience or benefit
   - Tagline focused on lifestyle and emotion
   - Copy emphasizing how people use and benefit from this product

4. TARGET AUDIENCE (real people):
   - Describe the specific person who would use this product
   - Their lifestyle, values, aspirations, activities

5. COLOR PALETTE:
   - 3-5 hex colors that complement both the product AND the editorial lifestyle scene

6. MOOD & ATMOSPHERE (human-centric):
   - Emotional tone of person using the product
   - Atmosphere of the lifestyle scenario

7. KEY PRODUCT FEATURES (in context of use):
   - Features shown through person actively using them
   - Benefits demonstrated by person's experience

8. CALL TO ACTION (lifestyle-focused):
   - CTA that speaks to the lifestyle or experience

9. IMAGE PROMPT (MUST feature person using product):
   - Detailed prompt for AI image generation
   - MUST explicitly describe: a person/human using, wearing, or interacting with this exact product
   - Include: person's activity, setting, lighting, mood, AND the product being used
   - Example format: "Editorial lifestyle photograph of [specific person description] [action with product] in [setting], [product visible and in use], [lighting], [mood], high-quality commercial photography"
   - The product MUST be visible and recognizable while being used by the person

10. VIDEO PROMPT (MUST feature person using product in motion):
   - Detailed prompt for AI video generation  
   - MUST show: person actively using product with motion and action
   - Include: person's movement, product interaction, setting, atmosphere
   - Example: "Editorial commercial video of [person] [action sequence with product], product in use throughout, [camera movement], [mood], professional cinematography"

Respond with a JSON object in this exact format:
{
  "visualStyle": "string describing editorial visual direction WITH PERSON using product",
  "messaging": "string with headline and key messaging focused on human experience",
  "targetAudience": "string describing the specific person/demographic who uses this product",
  "colorPalette": ["#hex1", "#hex2", "#hex3"],
  "mood": "string describing emotional tone of person using product",
  "keyFeatures": ["feature1 in use", "feature2 benefit", "feature3 experience"],
  "callToAction": "string with lifestyle-focused CTA",
  "imagePrompt": "DETAILED prompt explicitly showing person/human using this product in editorial lifestyle scenario",
  "videoPrompt": "DETAILED prompt explicitly showing person/human using this product in motion with editorial storytelling"
}

REMEMBER: The image and video prompts MUST feature a person/human using or interacting with the product. This is non-negotiable.`;
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
