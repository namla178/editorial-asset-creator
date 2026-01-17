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
            content: `You are an expert editorial art director, fashion brand strategist, and visual storyteller. 

Fill in the provided JSON structure with complete, detailed editorial brief based on the product information.

CRITICAL: FOCUS ON MAIN PRODUCT. Return a complete JSON object with ALL fields filled in. Do not leave any fields empty or with placeholder text.`,
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
   * Constructs the prompt using main_prompt + JSON structure template
   */
  private constructPrompt(productData: ProductData): string {
    const productInfo = [
      `Product Name: ${productData.name}`,
      productData.description ? `Description: ${productData.description}` : '',
      productData.category ? `Category: ${productData.category}` : '',
      productData.brand ? `Brand: ${productData.brand}` : '',
      productData.price ? `Price: ${productData.price}` : '',
    ].filter(Boolean).join('\n');

    // JSON structure template from image-prompt.json
    const jsonTemplate = {
      "campaign_meta": {
        "project_name": "",
        "brand_identity": "e.g., urban performance, sustainable minimalism, luxury streetwear",
        "platform_use_case": "Lookbook | Campaign | Banner | Social Editorial",
        "target_audience": {
          "persona": "",
          "emotional_driver": "e.g., freedom, rebellion, calm confidence"
        }
      },
      "brand_gravity_profile": {
        "brand_energy_level": "Low | Medium | High",
        "attitude": "e.g., bold, restrained, experimental, utilitarian",
        "risk_tolerance": "Low | Medium | High",
        "visual_gravity": "e.g., heavy, grounded, aggressive | light, minimal, airy",
        "references": [
          "Optional: iconic campaigns, cultural movements, or visual eras"
        ]
      },
      "editorial_constraints": {
        "image_type": "Editorial",
        "avoid_commercial_aesthetics": true,
        "allowed_imperfection_level": "Low | Medium | High",
        "authenticity_bias": "Prefer raw, imperfect, lived-in visuals"
      },
      "creative_concept": {
        "core_mood": "e.g., raw, tense, poetic, defiant",
        "narrative_theme": "One-sentence story about product focus and user experience behind the image",
        "editorial_statement": "Clear, opinionated message this image communicates"
      },
      "visual_hierarchy": {
        "primary_subject": "Product | Human | Environment",
        "secondary_subjects": ["Optional supporting elements"],
        "frame_dominance": {
          "primary_subject_percentage": "30-50%",
          "secondary_subject_percentage": "10-30%"
        },
        "frame_priority_rule": "If conflict occurs, prioritize product visibility over human expression."
      },
      "product_focus": {
        "key_items": [
          {
            "product_name": productData.name,
            "category": productData.category || "",
            "colorway_or_variant": ""
          }
        ],
        "visibility_style": "Integrated | Partial | Obscured | Symbolic",
        "interaction_type": "Worn | Placed | In-motion | Environmental"
      },
      "camera_and_composition": {
        "camera_angle": "Low | Eye-level | High | Off-axis",
        "camera_focus": "Product-centric | Human-centric | Environment-centric",
        "lens_feel": "Wide, cinematic, compressed, slightly distorted",
        "composition_style": "Asymmetrical | Center-weighted | Cropped | Dynamic",
        "depth_of_field": "Shallow | Medium | Deep"
      },
      "setting_and_environment": {
        "location_type": "Real-world, textured location",
        "environmental_drama": [
          "fog",
          "rain",
          "dust",
          "wind",
          "harsh sunlight"
        ],
        "time_of_day": "Golden hour | Overcast | Night | Harsh daylight"
      },
      "lifestyle_semantic_controls": {
        "positive_signals": [
          "raw movement",
          "tension or contrast",
          "individual focus",
          "uncontrolled nature",
          "weathered textures"
        ],
        "negative_signals": [
          "forced smiles",
          "group posing",
          "studio cleanliness",
          "perfect symmetry",
          "stock photography lighting"
        ]
      },
      "artistic_license": {
        "reality_bending_allowed": true,
        "surreal_elements": [
          "Optional symbolic or exaggerated elements"
        ],
        "symbolism_notes": "If surreal, define the intended meaning"
      },
      "text_and_text_visual": {
        "include_text": true,
        "text_content": {
          "headline": "",
          "supporting_line": ""
        },
        "text_intent": "Declarative | Provocative | Poetic | Minimal",
        "typography_style": {
          "font_character": "Bold editorial | Condensed | Handwritten | Geometric",
          "case_usage": "Uppercase | Sentence case | Mixed",
          "weight": "Light | Regular | Bold | Extra Bold"
        },
        "text_placement": {
          "position": "Top | Bottom | Center | Edge-aligned",
          "interaction_with_subject": "Overlapping | Framing | Background-only",
          "safe_area_rule": "Must not obstruct primary subject"
        },
        "text_visual_treatment": {
          "color": "High contrast | Monochrome | Muted",
          "effects": "None | Grain | Blur | Distress",
          "integration_style": "Feels native to the image, not overlaid"
        }
      },
      "post_production": {
        "color_grading": "e.g., muted earth tones, cool shadows, high contrast",
        "texture_treatment": "Film grain | Matte | Clean digital",
        "final_mood_check": "Does the grading reinforce the core mood?"
      }
    };


    const prompt = `
${productInfo}

JSON STRUCTURE TO FILL:
${JSON.stringify(jsonTemplate, null, 2)}`;

    return prompt;
  }

  /**
   * Parses the LLM response into a DesignBrief
   * Maps the editorial image brief format to the DesignBrief interface
   */
  private parseResponse(content: string, productName: string): DesignBrief {
    try {
      const parsed = JSON.parse(content);


      // Validate the new editorial brief structure (removed image_prompt_for_ai requirement)
      if (!parsed.campaign_meta || !parsed.creative_concept) {
        console.error('Missing required fields. Received:', JSON.stringify(parsed, null, 2));
        throw new Error('Missing required editorial brief fields');
      }

      // Extract color palette from post_production color_grading or use defaults
      const colorPalette = this.extractColorPalette(parsed);

      // Build visual style from multiple sections
      const visualStyle = this.buildVisualStyle(parsed);

      // Build messaging from text_and_text_visual
      const messaging = parsed.text_and_text_visual?.text_content?.headline 
        ? `${parsed.text_and_text_visual.text_content.headline}. ${parsed.text_and_text_visual.text_content.supporting_line || ''}`
        : parsed.creative_concept.editorial_statement;

      // Extract key features from product_focus
      const keyFeatures = parsed.product_focus?.key_items?.map((item: any) => 
        `${item.product_name} - ${item.category}`
      ) || [];

      // Build call to action
      const callToAction = this.buildCallToAction(parsed);

      // Build image prompt from the editorial brief sections
      const imagePrompt = this.buildImagePrompt(parsed, productName);

      return {
        productName,
        visualStyle,
        messaging,
        targetAudience: parsed.campaign_meta.target_audience.persona || 'Style-conscious consumers',
        colorPalette,
        mood: parsed.creative_concept.core_mood,
        keyFeatures,
        callToAction,
        imagePrompt: imagePrompt,
        videoPrompt: this.buildVideoPrompt(parsed),
        editorialBrief: parsed, // Store the full editorial brief JSON
        generatedAt: new Date(),
      };
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      throw new Error('Failed to parse design brief from LLM response');
    }
  }

  /**
   * Extracts a color palette from the editorial brief
   */
  private extractColorPalette(parsed: any): string[] {
    // Try to extract colors from color_grading description
    // For now, use a default palette based on mood
    const mood = parsed.creative_concept?.core_mood?.toLowerCase() || '';
    
    if (mood.includes('dark') || mood.includes('bold') || mood.includes('intense')) {
      return ['#1a1a2e', '#16213e', '#0f3460', '#e94560', '#ffffff'];
    } else if (mood.includes('light') || mood.includes('airy') || mood.includes('minimal')) {
      return ['#f8f9fa', '#e9ecef', '#dee2e6', '#495057', '#212529'];
    } else if (mood.includes('earth') || mood.includes('natural') || mood.includes('raw')) {
      return ['#8b7355', '#a0826d', '#c9b59a', '#3d3028', '#f4e8d8'];
    }
    
    // Default neutral palette
    return ['#2c3e50', '#34495e', '#95a5a6', '#ecf0f1', '#e74c3c'];
  }

  /**
   * Builds a comprehensive visual style description
   */
  private buildVisualStyle(parsed: any): string {
    const parts = [];
    
    if (parsed.creative_concept?.core_mood) {
      parts.push(`Mood: ${parsed.creative_concept.core_mood}`);
    }
    
    if (parsed.camera_and_composition) {
      const cam = parsed.camera_and_composition;
      parts.push(`${cam.lens_feel || 'Cinematic'} lens, ${cam.camera_angle || 'eye-level'} angle`);
      parts.push(`${cam.composition_style || 'Dynamic'} composition with ${cam.depth_of_field || 'medium'} depth of field`);
    }
    
    if (parsed.setting_and_environment) {
      const env = parsed.setting_and_environment;
      parts.push(`${env.location_type || 'Real-world location'} at ${env.time_of_day || 'golden hour'}`);
    }
    
    if (parsed.post_production?.color_grading) {
      parts.push(`Color: ${parsed.post_production.color_grading}`);
    }
    
    if (parsed.post_production?.texture_treatment) {
      parts.push(`Texture: ${parsed.post_production.texture_treatment}`);
    }
    
    return parts.join('. ');
  }

  /**
   * Builds a call to action from the editorial brief
   */
  private buildCallToAction(parsed: any): string {
    // Use text intent to guide CTA style
    const intent = parsed.text_and_text_visual?.text_intent?.toLowerCase() || '';
    
    if (intent.includes('provocative')) {
      return 'Experience It Now';
    } else if (intent.includes('poetic')) {
      return 'Discover More';
    } else if (intent.includes('minimal')) {
      return 'Explore';
    }
    
    return 'Shop Now';
  }

  /**
   * Builds an image prompt from the editorial brief sections
   */
  private buildImagePrompt(parsed: any, productName: string): string {
    const concept = parsed.creative_concept;
    const visual = parsed.visual_hierarchy;
    const product = parsed.product_focus?.key_items?.[0];
    const camera = parsed.camera_and_composition;
    const setting = parsed.setting_and_environment;
    const target = parsed.campaign_meta?.target_audience;
    
    // Build a comprehensive image prompt from all sections
    return `Editorial lifestyle photograph of ${target?.persona || 'a person'} ${parsed.product_focus?.interaction_type?.toLowerCase() || 'using'} ${product?.product_name || productName} in ${setting?.location_type || 'real-world setting'}. ${concept?.narrative_theme || 'Authentic lifestyle scenario'}. Product ${parsed.product_focus?.visibility_style?.toLowerCase() || 'visible'} and in use. ${camera?.camera_angle || 'Eye-level'} camera angle, ${camera?.lens_feel || 'cinematic'} lens. ${setting?.time_of_day || 'Natural'} lighting. ${concept?.core_mood || 'Authentic'} mood. ${camera?.composition_style || 'Dynamic'} composition with ${camera?.depth_of_field?.toLowerCase() || 'medium'} depth of field. High-quality editorial commercial photography, magazine quality, photorealistic.`;
  }

  /**
   * Builds a video prompt from the editorial brief
   */
  private buildVideoPrompt(parsed: any): string {
    const concept = parsed.creative_concept;
    const camera = parsed.camera_and_composition;
    const setting = parsed.setting_and_environment;
    const product = parsed.product_focus?.key_items?.[0];
    
    return `Editorial commercial video: ${concept.narrative_theme}. ${camera.lens_feel || 'Cinematic'} cinematography, ${camera.camera_angle || 'dynamic'} camera movements. Person actively using ${product?.product_name || 'product'} in ${setting.location_type || 'real-world setting'}. ${setting.time_of_day || 'Golden hour'} lighting. ${concept.core_mood} atmosphere. Product visible and in use throughout. Professional commercial quality, editorial storytelling style.`;
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
