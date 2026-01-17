import * as cheerio from 'cheerio';
import axios, { AxiosError } from 'axios';
import { ProductData, ImageMetadata, ImageViewType } from '@/types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import https from 'https';
import { logRequest, logResponse, logError } from '@/utils/logger';
import puppeteer from 'puppeteer';

/**
 * Service for scraping product data from e-commerce pages
 * Implements comprehensive image extraction with metadata tracking
 */
export class WebScraperService {
  private readonly timeout = 5000; // 15 seconds - quick timeout to detect blocking fast
  private readonly maxRetries = 1; // Reduced retries since we have fallback
  private readonly userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  private readonly downloadDir: string;
  private readonly httpsAgent: https.Agent;

  constructor() {
    this.downloadDir = path.join(process.cwd(), 'public', 'product-images');
    // Create custom HTTPS agent to avoid connection resets
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false, // Accept self-signed certificates
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 60000,
    });
    this.ensureDownloadDir();
  }

  /**
   * Ensures the download directory exists
   */
  private ensureDownloadDir(): void {
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  /**
   * Validates a URL format
   */
  validateUrl(url: string): { valid: boolean; error?: string } {
    if (!url || typeof url !== 'string') {
      return { valid: false, error: 'URL is required' };
    }

    try {
      const parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { valid: false, error: 'URL must use HTTP or HTTPS protocol' };
      }
      return { valid: true };
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }
  }

  /**
   * Scrapes product data from a URL with retry logic
   */
  async scrapeProductPage(url: string): Promise<ProductData> {
    const validation = this.validateUrl(url);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    logRequest('WebScraper', 'scrapeProductPage', { url });

    // Use Puppeteer as primary method for reliability
    console.log('\n  🤖 Using Puppeteer (headless browser) for maximum compatibility...');
    
    try {
      const productData = await this.scrapeWithPuppeteer(url);
      
      logResponse('WebScraper', 'scrapeProductPage', {
        method: 'puppeteer',
        url,
        productName: productData.name,
        imagesFound: productData.images?.length || 0,
        localImagesDownloaded: productData.localImagePaths?.length || 0,
        hasMetadata: !!productData.imageMetadata,
      });
      
      return productData;
    } catch (error) {
      const errorMessage = (error as Error).message;
      console.log(`  ✗ Puppeteer failed: ${errorMessage}`);
      
      logError('WebScraper', 'scrapeProductPage', error as Error, { url, method: 'puppeteer' });
      throw new Error(`Failed to scrape product page: ${errorMessage}. Please make sure the URL is a direct product page.`);
    }
  }

  /**
   * Attempts to scrape a product page
   */
  private async attemptScrape(url: string): Promise<ProductData> {
    try {
      console.log(`  Fetching page: ${url}`);
      console.log(`  Timeout: ${this.timeout}ms`);
      
      // Parse URL to get referrer
      const urlObj = new URL(url);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      const domain = urlObj.hostname.toLowerCase();
      
      // Known problematic domains that require special handling
      const strictDomains = ['tommy.com', 'tommyhilfiger.com'];
      const isStrictDomain = strictDomains.some(d => domain.includes(d));
      
      if (isStrictDomain) {
        console.log(`  ⚠️  WARNING: ${domain} has strict anti-bot protection.`);
        console.log(`  💡 RECOMMENDED: Use a product from Amazon, Nike, ASOS, or Zara instead.`);
        console.log(`  Or manually save the page HTML and provide it to the scraper.\n`);
      }
      
      const headers = {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'DNT': '1',
        'Referer': baseUrl,
      };

      // Generate curl command for debugging
      const curlHeaders = Object.entries(headers)
        .map(([key, value]) => `-H "${key}: ${value}"`)
        .join(' \\\n  ');
      const curlCommand = `curl -X GET "${url}" \\\n  ${curlHeaders} \\\n  --compressed \\\n  --max-time 60 \\\n  -L`;
      
      console.log('\n========== CURL COMMAND (Copy to Postman/Terminal) ==========');
      console.log(curlCommand);
      console.log('='.repeat(60) + '\n');
      
      const response = await axios.get(url, {
        timeout: this.timeout,
        httpsAgent: this.httpsAgent,
        headers,
        maxRedirects: 10,
        validateStatus: (status) => status < 500,
        decompress: true,
      });
      
      console.log(`  ✓ Page fetched successfully (${response.data.length} bytes)`);

      const html = response.data;
      return this.parseProductPage(url, html);
    } catch (error) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response) {
        const status = axiosError.response.status;
        if (status === 404) {
          throw new Error('Product page not found. Please check the URL and try again.');
        } else if (status === 403) {
          throw new Error('This website is blocking our access. Please try a product from another store like Nike, Amazon, or Jack & Jones.');
        } else if (status >= 500) {
          throw new Error(`The website is temporarily unavailable. Please try again later.`);
        }
      } else if (axiosError.code === 'ECONNABORTED') {
        throw new Error('The request took too long. Please check your internet connection and try again.');
      }
      
      throw error;
    }
  }

  /**
   * Parses HTML to extract product data
   */
  private async parseProductPage(url: string, html: string): Promise<ProductData> {
    const $ = cheerio.load(html);

    const name = this.extractProductName($);
    const description = this.extractProductDescription($);
    const images = this.extractProductImages($);
    const price = this.extractProductPrice($);
    const category = this.extractProductCategory($);
    
    // Log all extracted image URLs
    console.log(`\n========== EXTRACTED IMAGE URLs (${images.length} found) ==========`);
    images.forEach((imgUrl, idx) => {
      console.log(`  ${idx + 1}. ${imgUrl.substring(0, 150)}${imgUrl.length > 150 ? '...' : ''}`);
    });
    console.log('='.repeat(60));
    const brand = this.extractProductBrand($);

    if (!name) {
      throw new Error('Unable to find product information on this page. Please make sure you\'re using a direct product page URL (not a search results or category page).');
    }

    // Download product images locally with comprehensive metadata
    console.log(`\nExtracting and downloading up to ${images.length} product images with metadata...`);
    const { localImagePaths, imageMetadata } = await this.downloadImagesWithMetadata(images, url, $);
    
    // Show summary of downloaded images
    if (imageMetadata.length > 0) {
      console.log(`\n✓ Successfully processed ${imageMetadata.length} images:`);
      const sortedByQuality = [...imageMetadata].sort((a, b) => b.qualityScore - a.qualityScore);
      const topImages = sortedByQuality.slice(0, 5);
      console.log('  Top 5 quality images:');
      topImages.forEach((img, idx) => {
        console.log(`  ${idx + 1}. ${img.width}x${img.height}, ${Math.round(img.fileSize/1024)}KB, quality: ${img.qualityScore.toFixed(0)}, view: ${img.viewType}`);
      });
    }

    return {
      url,
      name,
      description: description || '',
      images,
      localImagePaths,
      imageMetadata,
      price,
      category,
      brand,
      extractedAt: new Date(),
    };
  }

  /**
   * Downloads images and extracts comprehensive metadata
   */
  private async downloadImagesWithMetadata(
    imageUrls: string[], 
    baseUrl: string,
    $: cheerio.CheerioAPI
  ): Promise<{ localImagePaths: string[]; imageMetadata: ImageMetadata[] }> {
    const localImagePaths: string[] = [];
    const imageMetadata: ImageMetadata[] = [];
    const maxImages = 10; // Reduced to prevent hanging on many images
    
    console.log(`\n========== DOWNLOADING IMAGES ==========`);
    console.log(`Total URLs found: ${imageUrls.length}`);
    console.log(`Will process: ${Math.min(imageUrls.length, maxImages)} images`);

    for (let i = 0; i < Math.min(imageUrls.length, maxImages); i++) {
      try {
        let imageUrl = imageUrls[i];
        
        // Handle relative URLs
        if (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
          const base = new URL(baseUrl);
          imageUrl = new URL(imageUrl, base.origin).toString();
        }

        console.log(`\n  [${i + 1}/${Math.min(imageUrls.length, maxImages)}] Starting download...`);
        console.log(`      URL: ${imageUrl.substring(0, 100)}...`);
        
        const response = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 10000, // Reduced from 15s to 10s
          httpsAgent: this.httpsAgent,
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Referer': baseUrl,
          },
          maxRedirects: 5,
        });
        
        console.log(`      ✓ Downloaded ${response.data.length} bytes`);

        // Determine file extension from content type or URL
        const contentType = response.headers['content-type'] || '';
        let extension = 'jpg';
        let format = 'jpeg';
        if (contentType.includes('png')) { extension = 'png'; format = 'png'; }
        else if (contentType.includes('webp')) { extension = 'webp'; format = 'webp'; }
        else if (contentType.includes('gif')) { extension = 'gif'; format = 'gif'; }
        else if (imageUrl.match(/\.(png|jpg|jpeg|webp|gif)/i)) {
          const match = imageUrl.match(/\.(png|jpg|jpeg|webp|gif)/i);
          if (match) {
            extension = match[1].toLowerCase();
            format = extension === 'jpg' ? 'jpeg' : extension;
          }
        }

        const filename = `${uuidv4()}.${extension}`;
        const filePath = path.join(this.downloadDir, filename);
        
        fs.writeFileSync(filePath, response.data);
        localImagePaths.push(filePath);
        
        // Extract image metadata using sharp
        const metadata = await this.extractImageMetadata(
          filePath, 
          imageUrl, 
          response.data.length, 
          format,
          i,
          $
        );
        imageMetadata.push(metadata);
        
        console.log(`      ✓ Saved: ${filename}`);
        console.log(`        Size: ${metadata.width}x${metadata.height}, ${Math.round(metadata.fileSize/1024)}KB`);
        console.log(`        Quality: ${metadata.qualityScore.toFixed(0)}, View: ${metadata.viewType}`);
      } catch (error) {
        const errorMsg = (error as Error).message;
        console.warn(`      ✗ Failed image ${i + 1}: ${errorMsg.substring(0, 100)}`);
        // Continue with other images - don't let one failure stop everything
      }
    }
    
    console.log(`\n========== DOWNLOAD COMPLETE ==========`);
    console.log(`Successfully downloaded: ${imageMetadata.length}/${Math.min(imageUrls.length, maxImages)} images`);
    
    // If we got no images at all, throw an error
    if (imageMetadata.length === 0) {
      throw new Error('Failed to download any product images. The website may be blocking downloads or images may not be accessible.');
    }

    return { localImagePaths, imageMetadata };
  }

  /**
   * Extracts comprehensive metadata from a downloaded image
   */
  private async extractImageMetadata(
    filePath: string,
    originalUrl: string,
    fileSize: number,
    format: string,
    index: number,
    $: cheerio.CheerioAPI
  ): Promise<ImageMetadata> {
    const sharpImage = sharp(filePath);
    const metadata = await sharpImage.metadata();
    
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    
    // Determine view type based on URL patterns, position, and context
    const viewType = this.determineViewType(originalUrl, index, $);
    
    // Calculate quality score based on multiple factors (0-100 scale)
    const qualityScore = this.calculateQualityScore(width, height, fileSize, format, index, viewType);
    
    // Determine if this is the main product image
    const isMainProductImage = this.isMainImage(index, viewType, qualityScore, width, height);
    
    // Determine source location
    const sourceLocation = this.determineSourceLocation(originalUrl);

    return {
      localPath: filePath,
      originalUrl,
      width,
      height,
      fileSize,
      format,
      viewType,
      qualityScore,
      isMainProductImage,
      sourceLocation,
      downloadedAt: new Date()
    };
  }

  /**
   * Determines the view type of an image based on various signals
   */
  private determineViewType(url: string, index: number, _$: cheerio.CheerioAPI): ImageViewType {
    const lowerUrl = url.toLowerCase();
    
    // Check for zoom/detail indicators
    if (lowerUrl.includes('zoom') || lowerUrl.includes('large') || lowerUrl.includes('hi-res') || 
        lowerUrl.includes('full') || lowerUrl.includes('xlarge')) {
      return 'zoom';
    }
    
    // Check for detail/closeup indicators
    if (lowerUrl.includes('detail') || lowerUrl.includes('closeup') || lowerUrl.includes('close-up')) {
      return 'detail';
    }
    
    // Check for angle indicators
    if (lowerUrl.includes('front') || lowerUrl.includes('_f_') || lowerUrl.includes('-f-')) {
      return 'front';
    }
    if (lowerUrl.includes('back') || lowerUrl.includes('_b_') || lowerUrl.includes('-b-') || lowerUrl.includes('rear')) {
      return 'back';
    }
    if (lowerUrl.includes('side') || lowerUrl.includes('_s_') || lowerUrl.includes('-s-') || 
        lowerUrl.includes('left') || lowerUrl.includes('right')) {
      return 'side';
    }
    
    // Check for lifestyle/context images
    if (lowerUrl.includes('lifestyle') || lowerUrl.includes('context') || lowerUrl.includes('scene') ||
        lowerUrl.includes('model') || lowerUrl.includes('wear') || lowerUrl.includes('use')) {
      return 'lifestyle';
    }
    
    // Check for alternate indicators
    if (lowerUrl.includes('alt') || lowerUrl.includes('_2') || lowerUrl.includes('_3') || 
        lowerUrl.includes('_4') || lowerUrl.includes('_5') || lowerUrl.includes('-2') ||
        lowerUrl.includes('-3') || lowerUrl.includes('-4') || lowerUrl.includes('-5')) {
      return 'alternate';
    }
    
    // First image is typically the main image
    if (index === 0) {
      return 'main';
    }
    
    return 'alternate';
  }

  /**
   * Calculates a quality score for an image (0-100 scale)
   * PRIORITY: Dimensions (resolution) is the most important factor
   */
  private calculateQualityScore(
    width: number, 
    height: number, 
    fileSize: number, 
    format: string,
    index: number,
    viewType: ImageViewType
  ): number {
    let score = 0;
    
    // DIMENSIONS SCORE (0-60) - HIGHEST PRIORITY
    // Resolution is the most important factor for AI image generation
    const pixels = width * height;
    const minDimension = Math.min(width, height);
    
    // Score based on total pixels
    if (pixels >= 4000000) score += 35;        // 4MP+ (2000x2000)
    else if (pixels >= 2500000) score += 32;   // 2.5MP+ (1600x1600)
    else if (pixels >= 1500000) score += 28;   // 1.5MP+ (1200x1200)
    else if (pixels >= 1000000) score += 24;   // 1MP+ (1000x1000)
    else if (pixels >= 500000) score += 18;    // 500K+ (700x700)
    else if (pixels >= 250000) score += 12;    // 250K+ (500x500)
    else if (pixels >= 100000) score += 6;     // 100K+ (316x316)
    else score += 2;
    
    // Bonus for minimum dimension (ensures image isn't too narrow/short)
    if (minDimension >= 1500) score += 25;     // Excellent
    else if (minDimension >= 1000) score += 20; // Very good
    else if (minDimension >= 800) score += 15;  // Good
    else if (minDimension >= 600) score += 10;  // Acceptable
    else if (minDimension >= 400) score += 5;   // Low
    else score += 1;                            // Very low
    
    // Aspect ratio score (0-10) - prefer near-square images for products
    const aspectRatio = width / height;
    if (aspectRatio >= 0.8 && aspectRatio <= 1.25) score += 10; // Near square
    else if (aspectRatio >= 0.6 && aspectRatio <= 1.67) score += 7;
    else score += 3;
    
    // File size score (0-10) - larger files typically have more detail
    if (fileSize >= 500000) score += 10;       // 500KB+
    else if (fileSize >= 200000) score += 8;   // 200KB+
    else if (fileSize >= 100000) score += 6;   // 100KB+
    else if (fileSize >= 50000) score += 4;    // 50KB+
    else score += 2;
    
    // Format score (0-5)
    if (format === 'png') score += 5;   // Lossless
    else if (format === 'webp') score += 4;
    else if (format === 'jpeg') score += 3;
    else score += 2;
    
    // Position score (0-5) - first images are often primary
    if (index === 0) score += 5;
    else if (index <= 2) score += 4;
    else if (index <= 5) score += 3;
    else score += 2;
    
    // View type score (0-10) - prefer main/zoom views for generation
    if (viewType === 'main') score += 10;
    else if (viewType === 'zoom') score += 9;
    else if (viewType === 'front') score += 8;
    else if (viewType === 'detail') score += 6;
    else score += 3;
    
    return Math.min(100, score);
  }

  /**
   * Determines if this is the main product image
   */
  private isMainImage(index: number, viewType: ImageViewType, qualityScore: number, width: number, height: number): boolean {
    // First image with good quality is usually the main image
    if (index === 0 && qualityScore >= 50) return true;
    
    // Explicitly marked as main view
    if (viewType === 'main' && qualityScore >= 50) return true;
    
    // High resolution front view
    if (viewType === 'front' && width >= 800 && height >= 800 && qualityScore >= 60) return true;
    
    return false;
  }

  /**
   * Determines the source location of an image
   */
  private determineSourceLocation(url: string): string {
    const lowerUrl = url.toLowerCase();
    
    if (lowerUrl.includes('thumb') || lowerUrl.includes('small') || lowerUrl.includes('mini')) return 'thumbnail';
    if (lowerUrl.includes('zoom') || lowerUrl.includes('large') || lowerUrl.includes('full') || lowerUrl.includes('hi-res')) return 'zoom';
    if (lowerUrl.includes('cdn') || lowerUrl.includes('cloudfront') || lowerUrl.includes('akamai')) return 'cdn';
    if (lowerUrl.includes('gallery') || lowerUrl.includes('carousel')) return 'gallery';
    
    return 'page';
  }

  /**
   * Gets the best quality main image for AI generation
   * PRIORITY: Dimensions first, then quality score
   */
  getBestMainImage(imageMetadata: ImageMetadata[]): ImageMetadata | undefined {
    // Sort by dimensions first (min dimension), then quality score
    const sortByDimensionsAndQuality = (a: ImageMetadata, b: ImageMetadata) => {
      const aMinDim = Math.min(a.width, a.height);
      const bMinDim = Math.min(b.width, b.height);
      
      // If dimension difference is significant (>200px), prioritize dimensions
      if (Math.abs(aMinDim - bMinDim) > 200) {
        return bMinDim - aMinDim;
      }
      // Otherwise use quality score
      return b.qualityScore - a.qualityScore;
    };
    
    // Filter for high-resolution images (min 800px)
    const highResImages = imageMetadata.filter(img => Math.min(img.width, img.height) >= 800);
    
    if (highResImages.length > 0) {
      // First, try to find high-res main product images
      const mainImages = highResImages.filter(img => img.isMainProductImage);
      if (mainImages.length > 0) {
        return mainImages.sort(sortByDimensionsAndQuality)[0];
      }
      
      // Fall back to high-res images with preferred views
      const preferredViews = highResImages.filter(
        img => img.viewType === 'main' || img.viewType === 'front' || img.viewType === 'zoom'
      );
      if (preferredViews.length > 0) {
        return preferredViews.sort(sortByDimensionsAndQuality)[0];
      }
      
      // Return highest resolution high-res image
      return highResImages.sort(sortByDimensionsAndQuality)[0];
    }
    
    // Fall back to any image, sorted by dimensions and quality
    console.log('  ⚠ No high-resolution images (800px+) found, using best available');
    return imageMetadata.sort(sortByDimensionsAndQuality)[0];
  }

  /**
   * Gets images suitable for video generation (high quality, good for animation)
   * PRIORITY: Dimensions first, then quality score
   */
  getBestImageForVideo(imageMetadata: ImageMetadata[]): ImageMetadata | undefined {
    // Sort by dimensions first (min dimension), then quality score
    const sortByDimensionsAndQuality = (a: ImageMetadata, b: ImageMetadata) => {
      const aMinDim = Math.min(a.width, a.height);
      const bMinDim = Math.min(b.width, b.height);
      
      // If dimension difference is significant (>200px), prioritize dimensions
      if (Math.abs(aMinDim - bMinDim) > 200) {
        return bMinDim - aMinDim;
      }
      return b.qualityScore - a.qualityScore;
    };
    
    // For video, prefer high-res images (min 800px) with clean backgrounds
    const highResImages = imageMetadata.filter(img => Math.min(img.width, img.height) >= 800);
    
    if (highResImages.length > 0) {
      const candidates = highResImages.filter(
        img => img.viewType === 'main' || img.viewType === 'front' || img.viewType === 'zoom'
      );
      
      if (candidates.length > 0) {
        return candidates.sort(sortByDimensionsAndQuality)[0];
      }
      
      return highResImages.sort(sortByDimensionsAndQuality)[0];
    }
    
    // Fall back to medium resolution (512px+)
    const mediumRes = imageMetadata.filter(img => Math.min(img.width, img.height) >= 512);
    if (mediumRes.length > 0) {
      console.log('  ⚠ No high-res images for video, using medium resolution (512px+)');
      return mediumRes.sort(sortByDimensionsAndQuality)[0];
    }
    
    // Last resort
    console.log('  ⚠ No suitable resolution images for video, using best available');
    return imageMetadata.sort(sortByDimensionsAndQuality)[0];
  }

  /**
   * Extracts product name from common selectors
   */
  private extractProductName($: cheerio.CheerioAPI): string {
    // List of invalid text patterns that should be rejected
    const invalidPatterns = [
      /you may also like/i,
      /customers who bought/i,
      /frequently bought/i,
      /related products/i,
      /similar items/i,
      /recommended for you/i,
      /sponsored products/i,
      /buy it with/i,
      /^\s*$/,  // Empty or whitespace only
    ];

    const selectors = [
      // Shopee specific selectors
      '[data-testid="pdp-product-title"]',
      '.product-name',
      'div[class*="product-title"]',
      'h1[class*="_2rQP"]', // Shopee uses obfuscated class names
      'span[class*="WKSQV"]',
      // Amazon specific selectors - multiple formats (high priority)
      '#productTitle',
      'span#productTitle',
      '#title_feature_div #title',
      '#title',
      '#btAsinTitle',
      'span.product-title-word-break',
      '[data-automation-id="productTitle"]',
      '.product-title-word-break',
      // Amazon Fashion/Bond specific
      '[data-testid="product-title"]',
      '[data-testid="title"]',
      '.product-title',
      'h1[data-cy="product-title"]',
      '.title-wrapper h1',
      // Amazon mobile/alternate layouts
      '#title span',
      '.a-size-large.product-title-word-break',
      '.a-size-medium.product-title-word-break',
      // Try h1 with specific classes
      'h1.a-size-large',
      'h1.a-size-medium',
      // Meta tags (reliable source)
      'meta[property="og:title"]',
      'meta[name="title"]',
      // Common e-commerce selectors
      '[data-testid="product-name"]',
      '.product-name',
      '#product-title',
      'h1.title',
      'h1[itemprop="name"]',
      '[itemprop="name"]',
      '.pdp-product-title',
      '.product-single__title',
      // Generic fallbacks
      'h1',
    ];

    // Debug: Log if we're on Amazon
    const isAmazon = $('link[rel="canonical"]').attr('href')?.includes('amazon') || 
                     $('meta[property="og:site_name"]').attr('content')?.toLowerCase().includes('amazon');
    if (isAmazon) {
      console.log('  [DEBUG] Detected Amazon page, trying Amazon-specific selectors...');
    }

    // Helper function to validate product name
    const isValidProductName = (text: string): boolean => {
      if (!text || text.length < 3 || text.length > 500) {
        return false;
      }
      // Check against invalid patterns
      for (const pattern of invalidPatterns) {
        if (pattern.test(text)) {
          console.log(`  [DEBUG] Rejected text matching pattern "${pattern}": ${text.substring(0, 50)}...`);
          return false;
        }
      }
      return true;
    };

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        if (selector.startsWith('meta')) {
          const content = element.attr('content');
          if (content) {
            // Clean up the title (remove site names like "Amazon.com:")
            const cleanTitle = content
              .replace(/\s*[-|:]\s*(Amazon|Amazon\.com).*$/i, '')
              .replace(/^\s*(Amazon\.com\s*[-|:]\s*)/i, '')
              .trim();
            if (isValidProductName(cleanTitle)) {
              console.log(`  [DEBUG] Found product name via "${selector}": ${cleanTitle.substring(0, 50)}...`);
              return cleanTitle;
            }
          }
        } else {
          const text = element.text().trim();
          // Clean up excessive whitespace
          const cleanText = text.replace(/\s+/g, ' ').trim();
          if (isValidProductName(cleanText)) {
            console.log(`  [DEBUG] Found product name via "${selector}": ${cleanText.substring(0, 50)}...`);
            return cleanText;
          }
        }
      }
    }

    // Last resort: try to extract from page title
    const pageTitle = $('title').text().trim();
    if (pageTitle) {
      // Clean Amazon-style titles: "Product Name : Amazon.com"
      const cleanedTitle = pageTitle
        .replace(/\s*[-|:]\s*(Amazon|Amazon\.com|Buy.*on Amazon).*$/i, '')
        .replace(/^\s*(Amazon\.com\s*[-|:]\s*)/i, '')
        .trim();
      if (isValidProductName(cleanedTitle)) {
        console.log(`  [DEBUG] Extracted product name from page title: ${cleanedTitle.substring(0, 50)}...`);
        return cleanedTitle;
      }
    }

    console.log('  [DEBUG] Could not find product name with any selector');
    return '';
  }

  /**
   * Extracts product description
   */
  private extractProductDescription($: cheerio.CheerioAPI): string {
    const selectors = [
      // Meta descriptions
      'meta[name="description"]',
      'meta[property="og:description"]',
      // Common e-commerce selectors
      '[data-testid="product-description"]',
      '.product-description',
      '#productDescription',
      '#product-description',
      '[itemprop="description"]',
      '.pdp-product-description',
      '.product-single__description',
      // Feature bullets
      '#feature-bullets',
      '.product-features',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        if (selector.startsWith('meta')) {
          const content = element.attr('content');
          if (content) return content.trim();
        } else {
          const text = element.text().trim();
          if (text) return text.substring(0, 2000); // Limit description length
        }
      }
    }

    return '';
  }

  /**
   * Extracts product images
   */
  private extractProductImages($: cheerio.CheerioAPI): string[] {
    const images: Set<string> = new Set();
    
    console.log('\n========== IMAGE EXTRACTION DEBUG ==========');

    const selectors = [
      // Amazon specific selectors (high priority)
      '#landingImage',
      '#imgBlkFront',
      '#main-image',
      '#imgTagWrapperId img',
      '.imgTagWrapper img',
      '#altImages img',
      '#imageBlock img',
      '[data-old-hires]',
      '[data-a-dynamic-image]',
      // Common e-commerce image selectors
      '[data-testid="product-image"] img',
      '.product-image img',
      '#product-image img',
      '.product-gallery img',
      '[itemprop="image"]',
      '.pdp-image img',
      '.product-single__photo img',
      // Open Graph image
      'meta[property="og:image"]',
      // Generic product images
      '.gallery img',
      // Nike specific selectors
      '.css-1b8ovvw img', // Nike gallery
      '[class*="galleryImage"] img',
      '[class*="productImage"] img',
      '[class*="ProductCard"] img',
      '[class*="hero"] img',
      'picture source',
      'picture img',
      // More generic selectors
      '[data-src]',
      '[data-image]',
      'img[src*="product"]',
      'img[src*="image"]',
    ];

    for (const selector of selectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        console.log(`  Selector "${selector}" matched ${elements.length} elements`);
      }
      elements.each((_, element) => {
        if (selector.startsWith('meta')) {
          const content = $(element).attr('content');
          if (content && this.isValidImageUrl(content)) {
            console.log(`    [meta] Found: ${content.substring(0, 80)}...`);
            images.add(content);
          }
        } else if (selector === 'picture source') {
          // Handle picture source elements
          const srcset = $(element).attr('srcset');
          if (srcset) {
            const srcsetImages = this.parseSrcset(srcset);
            srcsetImages.forEach(img => {
              if (this.isValidImageUrl(img)) {
                const highResSrc = this.getHigherQualityUrl(img);
                console.log(`    [picture srcset] Found: ${highResSrc.substring(0, 80)}...`);
                images.add(highResSrc);
              }
            });
          }
        } else {
          // Check multiple image sources - prioritize higher quality
          const src = $(element).attr('src');
          const dataSrc = $(element).attr('data-src');
          const srcset = $(element).attr('srcset');
          const dataImage = $(element).attr('data-image');
          // Amazon specific high-res attributes
          const dataOldHires = $(element).attr('data-old-hires');
          const dataDynamicImage = $(element).attr('data-a-dynamic-image');

          // Amazon high-res images (highest priority)
          if (dataOldHires && this.isValidImageUrl(dataOldHires)) {
            console.log(`    [data-old-hires] Found: ${dataOldHires.substring(0, 80)}...`);
            images.add(dataOldHires);
          }
          if (dataDynamicImage) {
            try {
              // data-a-dynamic-image contains JSON with image URLs and dimensions
              const dynamicImages = JSON.parse(dataDynamicImage);
              for (const [imgUrl] of Object.entries(dynamicImages)) {
                if (this.isValidImageUrl(imgUrl)) {
                  console.log(`    [data-a-dynamic-image] Found: ${imgUrl.substring(0, 80)}...`);
                  images.add(imgUrl);
                }
              }
            } catch {
              // Not valid JSON, skip
            }
          }

          if (src && this.isValidImageUrl(src)) {
            const highResSrc = this.getHigherQualityUrl(src);
            console.log(`    [src] Found: ${highResSrc.substring(0, 80)}...`);
            images.add(highResSrc);
          }
          if (dataSrc && this.isValidImageUrl(dataSrc)) {
            const highResSrc = this.getHigherQualityUrl(dataSrc);
            console.log(`    [data-src] Found: ${highResSrc.substring(0, 80)}...`);
            images.add(highResSrc);
          }
          if (dataImage && this.isValidImageUrl(dataImage)) {
            const highResSrc = this.getHigherQualityUrl(dataImage);
            console.log(`    [data-image] Found: ${highResSrc.substring(0, 80)}...`);
            images.add(highResSrc);
          }
          if (srcset) {
            const srcsetImages = this.parseSrcset(srcset);
            srcsetImages.forEach(img => {
              const highResSrc = this.getHigherQualityUrl(img);
              images.add(highResSrc);
            });
            if (srcsetImages.length > 0) {
              console.log(`    [srcset] Found ${srcsetImages.length} images`);
            }
          }
        }
      });
    }
    
    console.log(`  Total unique images from selectors: ${images.size}`);

    // Fallback: get any large images on the page
    if (images.size === 0) {
      $('img').each((_, element) => {
        const src = $(element).attr('src');
        const width = parseInt($(element).attr('width') || '0', 10);
        const height = parseInt($(element).attr('height') || '0', 10);

        if (src && this.isValidImageUrl(src)) {
          if (width >= 200 || height >= 200 || (!width && !height)) {
            const highResSrc = this.getHigherQualityUrl(src);
            images.add(highResSrc);
          }
        }
      });
    }

    return Array.from(images).slice(0, 30); // Increased to 30 images for better selection
  }

  /**
   * Extracts product price
   */
  private extractProductPrice($: cheerio.CheerioAPI): string | undefined {
    const selectors = [
      '[data-testid="product-price"]',
      '.product-price',
      '#priceblock_ourprice',
      '#priceblock_saleprice',
      '[itemprop="price"]',
      '.price',
      '.sale-price',
      '.current-price',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = element.text().trim();
        if (text) return text;
      }
    }

    return undefined;
  }

  /**
   * Extracts product category
   */
  private extractProductCategory($: cheerio.CheerioAPI): string | undefined {
    const selectors = [
      '[data-testid="product-category"]',
      '.product-category',
      '.breadcrumb a',
      '[itemprop="category"]',
      'nav.breadcrumbs a',
    ];

    for (const selector of selectors) {
      const elements = $(selector);
      if (elements.length) {
        const categories: string[] = [];
        elements.each((_, element) => {
          const text = $(element).text().trim();
          if (text && text.toLowerCase() !== 'home') {
            categories.push(text);
          }
        });
        if (categories.length) {
          return categories.join(' > ');
        }
      }
    }

    return undefined;
  }

  /**
   * Extracts product brand
   */
  private extractProductBrand($: cheerio.CheerioAPI): string | undefined {
    const selectors = [
      '[data-testid="product-brand"]',
      '.product-brand',
      '[itemprop="brand"]',
      '#bylineInfo',
      '.brand',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = element.text().trim();
        if (text) return text;
      }
    }

    return undefined;
  }

  /**
   * Attempts to get a higher quality version of an image URL
   * by replacing common size parameters
   */
  private getHigherQualityUrl(url: string): string {
    let highResUrl = url;
    
    // Amazon specific transformations - get highest quality images
    if (url.includes('media-amazon.com') || url.includes('amazon.com')) {
      // Amazon image URLs often have size codes like _AC_SR71,95_ or _SX342_
      // Replace with larger size codes for high-res images
      highResUrl = url
        .replace(/_AC_SR\d+,\d+_/g, '_AC_SL1500_')   // Small to large
        .replace(/_SX\d+_/g, '_SL1500_')             // Width constrained
        .replace(/_SY\d+_/g, '_SL1500_')             // Height constrained
        .replace(/_AC_SX\d+_/g, '_AC_SL1500_')       // Auto-crop width
        .replace(/_AC_SY\d+_/g, '_AC_SL1500_')       // Auto-crop height
        .replace(/_US\d+_/g, '_SL1500_')             // US size variant
        .replace(/_CR\d+,\d+,\d+,\d+_/g, '')         // Remove crop
        .replace(/_QL\d+_/g, '_QL100_')              // Max quality
        .replace(/_FMwebp_/g, '_')                    // Remove webp conversion
        .replace(/\._[^.]+_\./g, '._SL1500_.');      // Generic size replacement
      
      return highResUrl;
    }
    
    // Nike specific transformations
    if (url.includes('nike.com')) {
      // Replace t_default with t_PDP_1728 for higher resolution
      highResUrl = url.replace(/t_default/g, 't_PDP_1728_v1');
      // Replace t_thumb with higher quality
      highResUrl = highResUrl.replace(/t_thumb/g, 't_PDP_1728_v1');
    }
    
    // Common size parameter replacements
    const sizeReplacements = [
      [/w_\d+/, 'w_2000'],           // Width parameter
      [/h_\d+/, 'h_2000'],           // Height parameter
      [/c_limit/, 'c_fill'],         // Crop mode
      [/q_\d+/, 'q_90'],             // Quality parameter
      [/_small/g, '_large'],         // Size in filename
      [/_thumb/g, '_large'],         // Thumbnail to large
      [/_medium/g, '_large'],        // Medium to large
      [/\/small\//g, '/large/'],     // Size in path
      [/\/thumb\//g, '/large/'],     // Thumbnail in path
      [/\/medium\//g, '/large/'],    // Medium in path
      [/\d+x\d+/g, '2000x2000'],    // Dimension pattern
    ];
    
    for (const [pattern, replacement] of sizeReplacements) {
      highResUrl = highResUrl.replace(pattern, replacement as string);
    }
    
    return highResUrl;
  }

  /**
   * Validates if a string is a valid image URL
   */
  private isValidImageUrl(url: string): boolean {
    if (!url) return false;
    
    // Skip data URIs that are too small (likely placeholders)
    if (url.startsWith('data:')) {
      return url.length > 1000; // Only accept larger base64 images
    }

    // Skip common placeholder patterns
    const placeholderPatterns = [
      'placeholder',
      'loading',
      'spinner',
      'blank',
      '1x1',
      'pixel',
    ];
    
    const lowerUrl = url.toLowerCase();
    for (const pattern of placeholderPatterns) {
      if (lowerUrl.includes(pattern)) return false;
    }

    return true;
  }

  /**
   * Parses srcset attribute to extract image URLs
   */
  private parseSrcset(srcset: string): string[] {
    const images: string[] = [];
    const parts = srcset.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      const url = trimmed.split(/\s+/)[0];
      if (url && this.isValidImageUrl(url)) {
        images.push(url);
      }
    }

    return images;
  }

  /**
   * Scrapes a page using Puppeteer (fallback for blocked sites)
   */
  private async scrapeWithPuppeteer(url: string): Promise<ProductData> {
    console.log('  🌐 Launching headless browser...');
    
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
        '--user-agent=' + this.userAgent,
      ],
    });

    try {
      const page = await browser.newPage();
      
      // Set realistic viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(this.userAgent);
      
      // Set extra headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      });

      console.log(`  📄 Navigating to ${url}...`);
      
      // Navigate with longer timeout for Puppeteer
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      console.log('  ✓ Page loaded successfully');
      
      // Wait a bit for dynamic content
      await this.sleep(2000);

      // Get the HTML content
      const html = await page.content();
      
      await browser.close();
      console.log('  ✓ Browser closed');

      // Parse the HTML using existing parser
      return this.parseProductPage(url, html);
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const webScraperService = new WebScraperService();
