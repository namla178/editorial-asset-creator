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
   * Detects product category from product data (same logic as ImageGenerationService)
   */
  private detectProductCategory(productData: ProductData): string {
    const name = (productData.name || '').toLowerCase();
    const description = (productData.description || '').toLowerCase();
    const category = (productData.category || '').toLowerCase();
    const combinedText = `${name} ${description} ${category}`;
    
    const categoryKeywords: Record<string, string[]> = {
      footwear: ['shoe', 'shoes', 'sneaker', 'sneakers', 'boot', 'boots', 'sandal', 'sandals', 
                 'loafer', 'footwear', 'trainer', 'trainers', 'heel', 'heels', 'flat', 'flats'],
      bags: ['bag', 'bags', 'handbag', 'purse', 'tote', 'backpack', 'clutch', 'wallet', 'satchel',
             'crossbody', 'shoulder bag', 'messenger bag', 'duffle', 'briefcase'],
      jewelry: ['jewelry', 'jewellery', 'necklace', 'bracelet', 'ring', 'earring', 'earrings',
                'pendant', 'chain', 'bangle', 'watch', 'watches', 'timepiece'],
      eyewear: ['glasses', 'sunglasses', 'eyeglasses', 'eyewear', 'spectacles', 'shades', 'frames'],
      headwear: ['hat', 'hats', 'cap', 'caps', 'beanie', 'beret', 'fedora', 'snapback', 'bucket hat'],
      beauty: ['makeup', 'cosmetic', 'lipstick', 'mascara', 'foundation', 'skincare', 'serum',
               'perfume', 'fragrance', 'nail polish', 'beauty'],
      sports: ['sports', 'fitness', 'gym', 'workout', 'yoga', 'dumbbell', 'tennis', 'golf',
               'basketball', 'football', 'soccer', 'bicycle', 'helmet'],
      home: ['furniture', 'chair', 'table', 'sofa', 'couch', 'bed', 'desk', 'lamp', 'decor', 'rug'],
      food: ['food', 'beverage', 'drink', 'coffee', 'tea', 'wine', 'chocolate', 'snack', 'gourmet'],
      tech: ['phone', 'laptop', 'tablet', 'earbuds', 'headphones', 'camera', 'speaker', 'device',
             'gadget', 'electronic', 'smart', 'wireless'],
      apparel: ['jacket', 'coat', 'parka', 'shirt', 'pants', 'jeans', 'dress', 'skirt', 'sweater',
                'hoodie', 'blazer', 't-shirt', 'polo', 'vest', 'cardigan', 'trousers', 'shorts']
    };
    
    for (const [cat, keywords] of Object.entries(categoryKeywords)) {
      for (const keyword of keywords) {
        if (combinedText.includes(keyword)) {
          return cat;
        }
      }
    }
    
    return 'general';
  }

  /**
   * Gets category-specific video rules for the prompt with enhanced cinematic creativity
   */
  private getCategoryVideoRules(category: string, productName: string): string {
    const rules: Record<string, { 
      camera: string; 
      focus: string; 
      motion: string; 
      shots: string; 
      speed: string;
      lighting: string;
      visualFlair: string;
      emotionalBeat: string;
      ending: string; // NEW: Specific ending for each category
    }> = {
      footwear: {
        camera: 'Low angle tracking (15° upward) following feet in motion with slight dutch tilt for dynamism, or cinematic orbital pan with parallax background',
        focus: 'Shoes occupy 45-65% of frame, show texture details, stitching, material quality',
        motion: 'Confident walking with heel-toe rhythm, stepping onto interesting surfaces, playful kicks',
        shots: 'Opening: Dramatic close-up with bokeh background → Middle: Walking sequence with environment interaction → Closing: Hero power shot from low angle',
        speed: 'Medium with micro slow-motion at key moments (step landing)',
        lighting: 'Rim lighting on shoe edges, soft fill from front, dramatic shadows showing depth',
        visualFlair: 'Surface reflections, dust particles in light, environment tells a story',
        emotionalBeat: 'Confidence, freedom, style expression',
        ending: 'Subject stops walking, plants feet confidently, camera slowly lowers to hero angle and HOLDS on shoes for 1.5s - powerful stance, complete stillness'
      },
      bags: {
        camera: 'Elegant dolly with subtle crane movement, or 270° orbital showcase with depth of field shifts',
        focus: 'Bag 40-55% of frame, hardware details catch light, leather texture visible',
        motion: 'Graceful shoulder carry, elegant hand swing, stylish reach-in with manicured hands',
        shots: 'Opening: Bag reveal with light bloom → Middle: Lifestyle carry with fashion walk → Closing: Detail shot with hand caressing material',
        speed: 'Slow to medium, elegant continuous flow',
        lighting: 'Soft key light with rim highlights on edges, catchlights on hardware',
        visualFlair: 'Luxury environment, marble surfaces, golden hour warmth',
        emotionalBeat: 'Sophistication, aspiration, quiet luxury',
        ending: 'Hand gently rests on bag, camera slowly pushes in to bag detail, holds on hardware/texture for 1.5s - satisfied ownership moment'
      },
      jewelry: {
        camera: 'MACRO probe lens orbit, extreme close-up with focus pulls, gentle tilt revealing facets',
        focus: 'Jewelry 55-75% of frame - INTIMATE close-up showing every detail',
        motion: 'Subtle wrist rotation, gentle finger movement, light dancing across gems',
        shots: 'Opening: Sparkle burst from light hitting gems → Middle: Sensual pan showing craftsmanship → Closing: Piece on person with emotional connection',
        speed: 'Very slow, hypnotic, meditative luxury pace',
        lighting: 'Point light for sparkle, soft diffused fill, controlled reflections',
        visualFlair: 'Prismatic light effects, bokeh orbs, silk/velvet backgrounds',
        emotionalBeat: 'Preciousness, timelessness, intimate luxury',
        ending: 'Gentle wrist/hand comes to rest, light catches final sparkle, camera holds on jewelry with soft focus background for 2s - intimate, precious moment frozen in time'
      },
      eyewear: {
        camera: 'Face-level gimbal tracking with subtle push-in, or fashion editorial orbital',
        focus: 'Glasses clearly visible 35-50%, frame design and lens quality shown',
        motion: 'Confident put-on moment, head turn showing profile, reflections in lenses',
        shots: 'Opening: Stylish grab and put-on → Middle: Face turn with environment reflection in lenses → Closing: Confident direct gaze',
        speed: 'Medium editorial pace with attitude',
        lighting: 'Soft beauty lighting, controlled reflections in lenses, rim light on frames',
        visualFlair: 'Lens reflections showing environment, fashion editorial aesthetic',
        emotionalBeat: 'Confidence, mystery, personal style',
        ending: 'Subject turns to camera, slight confident smile, holds direct gaze through glasses for 1.5s - self-assured, mysterious, complete'
      },
      headwear: {
        camera: 'Head-level tracking with dynamic energy, or upward hero tilt',
        focus: 'Hat/cap 40-55% of frame, material and construction visible',
        motion: 'Stylish adjustment, confident head movement, walking with swagger',
        shots: 'Opening: Hat grab/adjustment with personality → Middle: Movement with street style energy → Closing: Pose with attitude',
        speed: 'Medium-fast with street style energy',
        lighting: 'Directional key creating interesting shadows, urban golden hour',
        visualFlair: 'Urban environment, authentic street style, personality expression',
        emotionalBeat: 'Individuality, urban cool, self-expression',
        ending: 'Subject stops, gives knowing look or nod, one final hat adjustment then holds confident pose for 1.5s - attitude locked in'
      },
      beauty: {
        camera: 'INTIMATE close-up with subtle breathing movement, macro texture reveals',
        focus: 'Product and skin/application area 55-75% of frame',
        motion: 'Sensual application, texture glide, dewy finish reveal',
        shots: 'Opening: Product beauty shot with light flare → Middle: Application with ASMR-quality detail → Closing: Transformation reveal with glow',
        speed: 'Very slow, sensual, luxurious caress',
        lighting: 'Soft beauty dish, skin-flattering, product catching light',
        visualFlair: 'Dewy textures, light catching shimmer, skin glow, minimalist elegance',
        emotionalBeat: 'Self-care ritual, transformation, inner glow',
        ending: 'Subject closes eyes in satisfaction or gives serene smile, camera slowly pulls back to reveal glowing result, holds on beautiful face for 2s - transformation complete, inner peace achieved'
      },
      sports: {
        camera: 'Dynamic tracking with speed ramping, low power angles, wide action establisher',
        focus: 'Equipment visible 45-65% during peak action moments',
        motion: 'Explosive action - running, lifting, jumping, training intensity',
        shots: 'Opening: Athlete mental preparation → Middle: Explosive action with slow-mo peak → Closing: Victory pose/exhausted triumph',
        speed: 'Speed ramping: fast action → dramatic slow-mo at climax → resume',
        lighting: 'Dramatic side lighting, sweat glistening, sun flares for outdoor',
        visualFlair: 'Sweat droplets in slow-mo, dust/chalk particles, intensity in eyes',
        emotionalBeat: 'Power, determination, triumph over challenge',
        ending: 'Athlete completes action, raises head/fist in triumph or stands catching breath, camera slowly circles to hero angle and holds for 1.5s - victory achieved, power demonstrated'
      },
      home: {
        camera: 'Cinematic dolly through space with depth, gentle orbital around furniture hero',
        focus: 'Furniture/item 55-70% of frame, material quality visible',
        motion: 'Natural living moments, settling into comfort, styling arrangements',
        shots: 'Opening: Atmospheric wide establishing → Middle: Person enjoying/interacting → Closing: Beauty shot with lived-in perfection',
        speed: 'Slow, peaceful, aspirational lifestyle',
        lighting: 'Natural window light, warm practical lamps, cozy atmosphere',
        visualFlair: 'Steam from coffee, dust motes in light, plants, curated lifestyle',
        emotionalBeat: 'Comfort, aspiration, sanctuary feeling',
        ending: 'Person settles into furniture with content sigh/smile, camera gently pulls back to show cozy scene, holds on peaceful vignette for 2s - sanctuary achieved, home is complete'
      },
      food: {
        camera: 'Overhead track, 45° beauty angle dolly, hero pour/drizzle shot, macro texture',
        focus: 'Food/beverage 55-75% of frame, texture and freshness paramount',
        motion: 'Pouring with viscosity, plating precision, first bite anticipation',
        shots: 'Opening: Hero product reveal with steam/condensation → Middle: Preparation/serving action → Closing: Enjoyment moment with satisfaction',
        speed: 'Slow for luxury texture, medium for energy/freshness',
        lighting: 'Soft directional key, backlight for steam/liquids, appetite appeal',
        visualFlair: 'Steam wisps, condensation droplets, sauce drips, fresh ingredient details',
        emotionalBeat: 'Craving, satisfaction, sensory pleasure',
        ending: 'Person takes first bite/sip with eyes closing in pleasure, or places down cup/fork with satisfaction, camera holds on plated food/drink hero shot for 1.5s - craving satisfied, delicious'
      },
      tech: {
        camera: 'Precise orbital with reflections controlled, tracking hand interaction, reveal push-in',
        focus: 'Device 55-70% of frame, screen content and build quality shown',
        motion: 'Satisfying unbox, responsive touch interaction, feature demonstration',
        shots: 'Opening: Product reveal with light sweep → Middle: Active use showing UI/features → Closing: Hero shot showing premium build',
        speed: 'Medium-slow, precise, premium tech aesthetic',
        lighting: 'Clean key with controlled screen reflections, edge lighting on device',
        visualFlair: 'Screen glow, premium materials, minimalist environment, future-forward',
        emotionalBeat: 'Innovation, capability, seamless experience',
        ending: 'Device placed down gently on surface, hands retreat from frame, camera slowly orbits to hero angle showing design, holds on product for 1.5s - premium object, innovation resting'
      },
      apparel: {
        camera: 'Fashion editorial tracking, dramatic angles, fabric movement emphasis',
        focus: 'Garment 50-70% of frame, fabric quality and fit visible',
        motion: 'Model walk with fabric flow, turn showing silhouette, styling moments',
        shots: 'Opening: Garment reveal with dramatic lighting → Middle: Movement showing drape and flow → Closing: Styled pose with attitude',
        speed: 'Medium fashion editorial rhythm with attitude',
        lighting: 'Fashion lighting with drama, rim lights on shoulders, moody atmosphere',
        visualFlair: 'Fabric catching light, wind effects, editorial environment',
        emotionalBeat: 'Style confidence, fashion-forward, personal expression',
        ending: 'Model strikes final pose with attitude, slight head tilt or confident stance, fabric settles, camera holds on styled silhouette for 1.5s - fashion moment captured'
      }
    };

    const rule = rules[category] || {
      camera: 'Smooth cinematic tracking or orbital shot with depth',
      focus: 'Product must occupy 45-65% of frame with clear details',
      motion: 'Natural, authentic product interaction with personality',
      shots: 'Opening: Compelling reveal → Middle: Story in use → Closing: Hero emotional payoff',
      speed: 'Medium pace with breathing room',
      lighting: 'Professional three-point lighting with mood',
      visualFlair: 'Environmental storytelling, bokeh, atmosphere',
      emotionalBeat: 'Connection, aspiration, satisfaction',
      ending: 'Subject settles into natural resting position, camera slows and holds on product hero shot for 1.5s - story complete'
    };

    return `🎬 ${category.toUpperCase()} CINEMATIC VIDEO DIRECTION:

📹 CAMERA WORK:
${rule.camera}

🎯 PRODUCT FOCUS:
${rule.focus}

🏃 MOTION & ACTION:
${rule.motion}

🎬 SHOT SEQUENCE:
${rule.shots}

⏱️ PACING:
${rule.speed}

💡 LIGHTING DESIGN:
${rule.lighting}

✨ VISUAL FLAIR:
${rule.visualFlair}

❤️ EMOTIONAL BEAT:
${rule.emotionalBeat}

🏁 SATISFYING ENDING (CRITICAL):
${rule.ending}`;
  }

  /**
   * Extracts color info from product data
   */
  private extractProductColorInfo(productData: ProductData): string {
    const name = productData.name || '';
    const description = productData.description || '';
    const combinedText = `${name} ${description}`.toLowerCase();
    
    const colors = ['olive', 'green', 'navy', 'blue', 'black', 'white', 'cream', 'beige', 
                    'brown', 'red', 'yellow', 'gold', 'silver', 'grey', 'gray', 'pink', 'purple'];
    
    const found = colors.filter(c => combinedText.includes(c));
    return found.length > 0 ? `${found.join(' ')} ${productData.category || 'product'}` : productData.name;
  }

  /**
   * Gets creative visual style suggestions based on mood
   */
  private getCreativeStyle(mood: string, category: string): string {
    const moodStyles: Record<string, { colorGrade: string; atmosphere: string; energy: string }> = {
      'luxurious': {
        colorGrade: 'Rich blacks, warm highlights, film-like grain, high contrast',
        atmosphere: 'Opulent, exclusive, timeless elegance',
        energy: 'Slow, deliberate, every moment precious'
      },
      'energetic': {
        colorGrade: 'Vibrant saturation, punchy contrast, dynamic range',
        atmosphere: 'Alive, dynamic, full of possibility',
        energy: 'Fast cuts, speed ramping, kinetic motion'
      },
      'minimalist': {
        colorGrade: 'Clean whites, subtle tones, gentle contrast',
        atmosphere: 'Serene, focused, intentional simplicity',
        energy: 'Calm, breathing room, elegant pauses'
      },
      'bold': {
        colorGrade: 'Strong colors, graphic contrast, striking tones',
        atmosphere: 'Confident, unapologetic, statement-making',
        energy: 'Powerful movements, impactful moments'
      },
      'warm': {
        colorGrade: 'Golden tones, soft shadows, cozy warmth',
        atmosphere: 'Inviting, comforting, emotionally resonant',
        energy: 'Gentle, natural, authentic moments'
      },
      'modern': {
        colorGrade: 'Cool undertones, clean contrast, contemporary palette',
        atmosphere: 'Forward-thinking, fresh, innovative',
        energy: 'Smooth, precise, tech-forward rhythm'
      }
    };

    const style = moodStyles[mood.toLowerCase()] || moodStyles['modern'];
    return `🎨 VISUAL STYLE:
- Color Grade: ${style.colorGrade}
- Atmosphere: ${style.atmosphere}  
- Energy: ${style.energy}`;
  }

  /**
   * Gets detailed scene/environment context based on category
   */
  private getSceneContext(category: string, mood: string, brand: string): string {
    const scenes: Record<string, {
      setting: string;
      timeOfDay: string;
      narrative: string;
      character: string;
      supportingElements: string;
      atmosphere: string;
      soundscape: string;
    }> = {
      footwear: {
        setting: 'Urban downtown district with contemporary architecture - clean sidewalks, modern storefronts with large glass windows, interesting geometric shadows from buildings',
        timeOfDay: 'Golden hour (late afternoon) - warm directional sunlight creating long shadows, or blue hour for moody urban feel',
        narrative: 'A confident individual heading somewhere meaningful - perhaps to meet friends, starting a new adventure, or simply owning their daily commute with style',
        character: 'Young professional (25-35), impeccably styled, confident body language, purposeful stride, genuine personality shining through',
        supportingElements: 'Interesting pavement textures (cobblestones, concrete patterns), puddle reflections, passing city life blurred in background, architectural details',
        atmosphere: 'Energetic yet focused, urban sophistication, sense of momentum and purpose',
        soundscape: 'Footsteps echoing rhythmically, subtle city ambiance, modern upbeat music undertone'
      },
      bags: {
        setting: 'Upscale hotel lobby or luxury boutique interior - marble floors, soft leather seating, curated art on walls, fresh flowers in designer vases',
        timeOfDay: 'Soft morning light streaming through large windows, or elegant evening with warm interior lighting',
        narrative: 'A sophisticated individual preparing for or returning from something important - a business meeting, a special occasion, or simply a day of being effortlessly stylish',
        character: 'Elegant professional (28-40), refined taste evident in every detail, graceful movements, quiet confidence',
        supportingElements: 'Gold hardware accents in environment matching bag, soft textiles, fresh flowers, coffee cup on marble surface, luxury car glimpsed through window',
        atmosphere: 'Quiet luxury, understated elegance, aspirational lifestyle without ostentation',
        soundscape: 'Soft ambient music, gentle footsteps on marble, subtle café sounds'
      },
      jewelry: {
        setting: 'Intimate setting - elegant dressing table area, high-end boudoir, or minimalist space that lets jewelry be the star',
        timeOfDay: 'Soft diffused daylight or carefully controlled warm evening light - creating sparkle without harsh reflections',
        narrative: 'A special moment of adornment - preparing for an important event, receiving a meaningful gift, or a quiet moment of self-appreciation',
        character: 'Refined individual (25-45), appreciating beauty, intimate and personal moment, hands well-groomed',
        supportingElements: 'Velvet surfaces, soft fabrics, mirror reflections, other luxury items suggesting lifestyle (perfume bottle, silk scarf), warm skin tones',
        atmosphere: 'Intimate, precious, timeless elegance, personal ritual',
        soundscape: 'Near silence with soft ambient tones, subtle sparkle sounds, intimate breathing'
      },
      eyewear: {
        setting: 'Contemporary urban environment - rooftop with city views, modern café terrace, or sleek architectural space with interesting light play',
        timeOfDay: 'Golden hour with sun flares playing through lenses, or bright midday with interesting shadow patterns',
        narrative: 'Stepping out into the world with confidence - ready to see and be seen, embracing the day with style',
        character: 'Fashion-conscious individual (22-38), self-assured, aware of their image, natural charisma',
        supportingElements: 'Interesting reflections in lenses showing environment, city skyline, modern furniture, plants, coffee or drink',
        atmosphere: 'Cool confidence, fashion-forward, seeing the world through a stylish lens',
        soundscape: 'Urban ambiance, café chatter, subtle electronic music'
      },
      headwear: {
        setting: 'Authentic urban street scene - graffiti walls with artistic merit, interesting architecture, urban plaza, or creative district',
        timeOfDay: 'Late afternoon warm light, or overcast for even dramatic lighting, or night with neon/street lights',
        narrative: 'Expressing personal style in the urban jungle - someone who creates their own trends, comfortable in their identity',
        character: 'Style-forward individual (18-32), authentic personality, street style sensibility, confident body language',
        supportingElements: 'Interesting wall textures, urban art, other stylish people in soft focus, skateboard or bike, coffee cup, authentic street life',
        atmosphere: 'Urban cool, authentic self-expression, cultural relevance, creative energy',
        soundscape: 'Street sounds, hip-hop or electronic beats, skateboard wheels, city life'
      },
      beauty: {
        setting: 'Serene personal sanctuary - minimalist bathroom with natural materials, clean vanity setup, or spa-like environment with soft textures',
        timeOfDay: 'Soft morning light (self-care ritual to start the day) or warm evening glow (getting ready for something special)',
        narrative: 'A moment of self-care and transformation - taking time for oneself, the ritual of beauty, revealing inner confidence',
        character: 'Individual with healthy glowing skin (20-40), peaceful expression, intimate connection with self, natural beauty enhanced',
        supportingElements: 'Fresh flowers, clean towels, minimal skincare products arranged artfully, natural materials (wood, stone), mirror reflections, soft fabrics',
        atmosphere: 'Serene, intimate, transformative, self-love ritual',
        soundscape: 'Peaceful silence, water sounds, soft breathing, ASMR-quality product sounds'
      },
      sports: {
        setting: 'Professional training environment - state-of-the-art gym, outdoor track at dawn, or natural landscape for outdoor sports',
        timeOfDay: 'Dawn (fresh start, determination) or dramatic lighting during workout, golden hour for outdoor',
        narrative: 'Pushing limits, achieving goals - an athlete in their element, dedication and power on display, the journey to excellence',
        character: 'Fit athlete (20-35), intense focus, powerful physique, determination in eyes, authentic athletic form',
        supportingElements: 'Quality equipment, sweat glistening, chalk dust, water bottle, towel, inspirational environment, other athletes in background',
        atmosphere: 'Intense, powerful, aspirational, triumph over challenge',
        soundscape: 'Heavy breathing, equipment sounds, heartbeat, motivational music building'
      },
      home: {
        setting: 'Aspirational living space - sunlit living room with plants, cozy reading corner, modern apartment with city views, or warm kitchen',
        timeOfDay: 'Golden hour sunlight streaming through windows, or cozy evening with warm lamp light',
        narrative: 'Creating sanctuary - making a house a home, enjoying the comfort of thoughtfully chosen pieces, living beautifully',
        character: 'Lifestyle-conscious individual (28-45), relaxed yet stylish, enjoying their space, authentic comfort',
        supportingElements: 'Indoor plants, books, coffee/tea, soft textiles (throws, pillows), natural materials, pet, curated decor items',
        atmosphere: 'Warm, inviting, aspirational yet attainable, hygge comfort',
        soundscape: 'Soft ambient sounds, coffee brewing, pages turning, gentle music'
      },
      food: {
        setting: 'Inviting dining environment - rustic wooden table, modern kitchen island, café window seat, or outdoor terrace',
        timeOfDay: 'Bright natural light for freshness, or warm evening ambiance for indulgence',
        narrative: 'The joy of food - anticipation, preparation, the first satisfying bite, sharing or savoring alone',
        character: 'Food appreciator (25-50), genuine enjoyment visible, hands that know food, authentic reactions',
        supportingElements: 'Beautiful tableware, fresh ingredients, napkins, drinks, interesting backgrounds, steam rising, condensation on glass',
        atmosphere: 'Appetizing, sensory pleasure, comfort, celebration of taste',
        soundscape: 'Sizzling, pouring, gentle clinking, satisfied sounds, ambient café/kitchen'
      },
      tech: {
        setting: 'Clean modern workspace - minimalist desk setup, contemporary office, or lifestyle setting showing tech integration',
        timeOfDay: 'Clean daylight for clarity, or evening with screen glow and ambient lighting',
        narrative: 'Seamless technology integration - productivity, creativity, staying connected, technology enhancing life',
        character: 'Tech-savvy professional/creative (22-40), focused yet relaxed, natural interaction with technology',
        supportingElements: 'Clean desk accessories, plants, coffee, notebook, other premium devices, interesting background blur',
        atmosphere: 'Clean, innovative, productive, future-forward',
        soundscape: 'Subtle UI sounds, keyboard clicks, notification tones, ambient electronic'
      },
      apparel: {
        setting: 'Fashion-forward environment - editorial studio, urban architecture, natural landscape matching garment vibe, or stylish interior',
        timeOfDay: 'Dramatic fashion lighting, golden hour for warmth, or moody overcast for editorial feel',
        narrative: 'Making a statement - dressing as self-expression, the confidence of wearing something perfect, fashion as identity',
        character: 'Fashion-conscious individual (20-40), strong presence, model-quality movement, authentic style expression',
        supportingElements: 'Interesting textures complementing garment, wind for fabric movement, architectural elements, other fashion items',
        atmosphere: 'Editorial, fashion-forward, aspirational, confident self-expression',
        soundscape: 'Fabric movement sounds, fashion show ambiance, modern music'
      }
    };

    const scene = scenes[category] || scenes['apparel'];

    return `🎭 SCENE CONTEXT & STORYTELLING:

📍 SETTING:
${scene.setting}

🌅 TIME OF DAY:
${scene.timeOfDay}

📖 NARRATIVE:
${scene.narrative}

👤 CHARACTER:
${scene.character}

🎨 SUPPORTING ELEMENTS:
${scene.supportingElements}

🌫️ ATMOSPHERE:
${scene.atmosphere}

🔊 SOUNDSCAPE FEEL:
${scene.soundscape}`;
  }

  /**
   * Gets environment suggestions based on category and brand
   */
  private getEnvironmentSuggestion(category: string, brand: string): string {
    const environments: Record<string, string[]> = {
      footwear: ['Urban streets with interesting textures', 'Modern architecture with clean lines', 'Nature path with dynamic elements', 'Studio with dramatic lighting'],
      bags: ['Luxury interior with marble and gold accents', 'Boutique hotel lobby', 'Modern art gallery', 'Sunlit European street'],
      jewelry: ['Black velvet void with dramatic lighting', 'Intimate boudoir setting', 'High-end jeweler studio', 'Sunset balcony with city views'],
      eyewear: ['Fashion studio with seamless backdrop', 'Urban rooftop at golden hour', 'Modern café interior', 'Beach with sun flares'],
      headwear: ['Street style urban environment', 'Graffiti wall with character', 'Skate park or urban plaza', 'Festival atmosphere'],
      beauty: ['Clean beauty studio with soft light', 'Minimalist bathroom sanctuary', 'Vanity setup with natural light', 'Spa-like serene environment'],
      sports: ['Professional training facility', 'Outdoor track at dawn', 'Modern gym with dramatic lighting', 'Nature trail with epic backdrop'],
      home: ['Sunlit living room with plants', 'Cozy reading nook', 'Modern apartment with city views', 'Warm kitchen with natural materials'],
      food: ['Rustic wooden table with natural props', 'Modern kitchen with clean lines', 'Café setting with atmosphere', 'Outdoor dining with natural light'],
      tech: ['Minimalist desk setup', 'Modern office environment', 'Clean studio with gradient backdrop', 'Lifestyle setting showing integration'],
      apparel: ['Fashion studio with editorial lighting', 'Urban environment with texture', 'Natural setting matching brand', 'Architectural space with interest']
    };

    const options = environments[category] || environments['apparel'];
    return `🏛️ ENVIRONMENT OPTIONS:\n${options.map((e, i) => `${i + 1}. ${e}`).join('\n')}`;
  }

  /**
   * Constructs an optimized prompt for editorial video generation with person using product
   * Now uses category-specific rules, creative directions, and product preservation requirements
   */
  private constructVideoPrompt(brief: DesignBrief, productData: ProductData): string {
    const productName = productData.name || 'product';
    const brand = productData.brand || '';
    const visualStyle = brief.visualStyle || 'modern, clean';
    const mood = brief.mood || 'positive';
    
    // Detect category and get specific rules
    const category = this.detectProductCategory(productData);
    const categoryRules = this.getCategoryVideoRules(category, productName);
    const productColorInfo = this.extractProductColorInfo(productData);
    const creativeStyle = this.getCreativeStyle(mood, category);
    const environmentSuggestion = this.getEnvironmentSuggestion(category, brand);
    const sceneContext = this.getSceneContext(category, mood, brand);
    
    console.log(`🎬 Video Category Detected: ${category}`);
    console.log(`📦 Video Product Info: ${productColorInfo}`);
    console.log(`🎨 Visual Mood: ${mood}`);
    
    // Build comprehensive video prompt with product preservation and creative direction
    const videoPrompt = `🔴🔴🔴 CRITICAL PRODUCT IDENTITY RULES 🔴🔴🔴

THIS VIDEO MUST FEATURE: ${productColorInfo}
REFERENCE IMAGE SHOWS: ${productColorInfo} (PRESERVE EXACTLY)

⚠️ PRODUCT FIDELITY REQUIREMENTS:
1. Product colors MUST match reference in ALL frames - NO color shifts
2. Product design/details MUST remain consistent throughout video
3. Product MUST be hero element, visible in 75%+ of frames
4. NEVER substitute, modify, or reimagine the product
5. Maintain exact material texture and finish appearance

═══════════════════════════════════════════════════════════

🎬 PREMIUM CINEMATIC COMMERCIAL

🏷️ PRODUCT: ${productName}${brand ? ` by ${brand}` : ''}
🎭 STYLE: ${visualStyle}
💫 MOOD: ${mood}, aspirational, emotionally resonant

═══════════════════════════════════════════════════════════

${sceneContext}

═══════════════════════════════════════════════════════════

${categoryRules}

${creativeStyle}

${environmentSuggestion}

═══════════════════════════════════════════════════════════

🎥 CINEMATIC DIRECTION WITH SATISFYING ENDING:

1️⃣ HOOK (0-1.5s):
   - Immediate visual intrigue - product or compelling action
   - Dynamic camera movement or reveal
   - Viewer captivated within first 0.5 seconds

2️⃣ BUILD (1.5-4s):
   - Natural product demonstration in lifestyle context
   - Show product solving problem or enhancing life
   - Emotional connection through authentic interaction
   - Rising action - building toward climax

3️⃣ CLIMAX (4-6s):
   - Peak moment of product showcase
   - Most impactful visual of the video
   - Product in hero position with perfect framing
   - Emotional high point

4️⃣ RESOLUTION & LANDING (6-8s) ⭐ CRITICAL FOR SATISFYING ENDING:
   - SLOW DOWN camera movement gradually
   - Gentle ease-out to final hero shot
   - Hold on product for 1-1.5 seconds at end
   - Final frame: Product centered, perfectly lit, STATIC hold
   - Subject's satisfied expression or completed action
   - Feeling of completeness and fulfillment
   - Camera settles into rest position (no abrupt stop)

═══════════════════════════════════════════════════════════

🎯 ENDING REQUIREMENTS (PREVENTS ABRUPT CUT):
- Last 2 seconds: Camera MUST slow to near-static
- Final 1 second: HOLD on hero product shot (no movement)
- Ending feels like natural conclusion, NOT cut off
- Subject reaches natural stopping point (sits, stands still, poses)
- Include "landing" moment - action comes to graceful rest
- Final frame composition: Product prominent, balanced, resolved

🎬 ENDING TECHNIQUES TO USE:
1. Gentle push-in to product, hold on close-up
2. Subject looks at product with satisfaction, camera holds
3. Slow orbital settles to front-facing hero angle
4. Wide shot with subject settling into confident pose
5. Product placed down gently, hands retreat, hold on product

═══════════════════════════════════════════════════════════

⚙️ TECHNICAL SPECIFICATIONS:
- Cinematic 24fps with filmic motion blur
- Professional depth of field (shallow DOF on product hero moments)
- Smooth stabilized camera movement (gimbal quality)
- High dynamic range lighting
- Color graded for brand consistency
- Duration: 8 seconds (FULL duration, use all time)
- CRITICAL: Last 1.5s must be deceleration to static hold

🚫 AVOID:
- ABRUPT ENDING - video must not feel cut off
- Ending mid-motion or mid-action
- Camera still moving at final frame
- Subject in awkward transitional pose at end
- Product obscured or out of focus at ending
- Feeling of incompleteness

✅ ACHIEVE:
- Satisfying "landing" at video end
- Final frame could be a print ad
- Viewer feels story is complete
- Natural conclusion, not interruption
- Product as undeniable hero in final shot
- Memorable closing impression`;

    return videoPrompt;
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
          // Enhanced quality parameters for creative video generation
          enhancePrompt: true, // Let Veo enhance the prompt for better results
          personGeneration: 'allow_adult', // Allow adult person generation for lifestyle content
          // Note: Veo 3.0 internally handles quality optimization
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
