import * as cheerio from 'cheerio';
import axios from 'axios';
import { ProductData, ImageMetadata, ImageViewType } from '@/types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import https from 'https';
import { logRequest, logResponse, logError } from '@/utils/logger';
import puppeteer from 'puppeteer';

// ============================================================================
// CONSTANTS
// ============================================================================

const CONFIG = {
  MAX_IMAGES: 10,
  MAX_DESCRIPTION_LENGTH: 2000,
  IMAGE_DOWNLOAD_TIMEOUT: 15000,
  PAGE_LOAD_TIMEOUT: 30000,
  DYNAMIC_CONTENT_WAIT: 3000,
  LAZY_LOAD_WAIT: 1500,
  MIN_IMAGE_SIZE_BYTES: 1000,
  HIGH_RES_MIN_DIMENSION: 800,
  MEDIUM_RES_MIN_DIMENSION: 512,
} as const;

const HTTPS_CONFIG = {
  rejectUnauthorized: false,
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
} as const;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const PLACEHOLDER_PATTERNS = ['placeholder', 'loading', 'spinner', 'blank', '1x1', 'pixel'];

const INVALID_NAME_PATTERNS = [
  /you may also like/i,
  /customers who bought/i,
  /frequently bought/i,
  /related products/i,
  /similar items/i,
  /recommended for you/i,
  /sponsored products/i,
  /buy it with/i,
  /^\s*$/,
];

// ============================================================================
// SELECTORS
// ============================================================================

const SELECTORS = {
  productName: [
    // Shopee
    '[data-testid="pdp-product-title"]', '.product-name', 'div[class*="product-title"]',
    'h1[class*="_2rQP"]', 'span[class*="WKSQV"]',
    // Amazon
    '#productTitle', 'span#productTitle', '#title_feature_div #title', '#title',
    '#btAsinTitle', 'span.product-title-word-break', '[data-automation-id="productTitle"]',
    '.product-title-word-break', '[data-testid="product-title"]', '[data-testid="title"]',
    '.product-title', 'h1[data-cy="product-title"]', '.title-wrapper h1', '#title span',
    '.a-size-large.product-title-word-break', '.a-size-medium.product-title-word-break',
    'h1.a-size-large', 'h1.a-size-medium',
    // Meta tags
    'meta[property="og:title"]', 'meta[name="title"]',
    // Generic
    '[data-testid="product-name"]', '.product-name', '#product-title', 'h1.title',
    'h1[itemprop="name"]', '[itemprop="name"]', '.pdp-product-title',
    '.product-single__title', 'h1',
  ],
  productDescription: [
    'meta[name="description"]', 'meta[property="og:description"]',
    '[data-testid="product-description"]', '.product-description', '#productDescription',
    '#product-description', '[itemprop="description"]', '.pdp-product-description',
    '.product-single__description', '#feature-bullets', '.product-features',
  ],
  productImages: [
    // Amazon
    '#landingImage', '#imgBlkFront', '#main-image', '#imgTagWrapperId img',
    '.imgTagWrapper img', '#altImages img', '#imageBlock img',
    '[data-old-hires]', '[data-a-dynamic-image]',
    // Generic e-commerce
    '[data-testid="product-image"] img', '.product-image img', '#product-image img',
    '.product-gallery img', '[itemprop="image"]', '.pdp-image img',
    '.product-single__photo img', 'meta[property="og:image"]', '.gallery img',
    // Nike
    '.css-1b8ovvw img', '[class*="galleryImage"] img', '[class*="productImage"] img',
    '[class*="ProductCard"] img', '[class*="hero"] img', 'picture source', 'picture img',
    // Fallback
    '[data-src]', '[data-image]', 'img[src*="product"]', 'img[src*="image"]',
  ],
  productPrice: [
    '[data-testid="product-price"]', '.product-price', '#priceblock_ourprice',
    '#priceblock_saleprice', '[itemprop="price"]', '.price', '.sale-price', '.current-price',
  ],
  productCategory: [
    '[data-testid="product-category"]', '.product-category', '.breadcrumb a',
    '[itemprop="category"]', 'nav.breadcrumbs a',
  ],
  productBrand: [
    '[data-testid="product-brand"]', '.product-brand', '[itemprop="brand"]',
    '#bylineInfo', '.brand',
  ],
} as const;

// ============================================================================
// SERVICE CLASS
// ============================================================================

/**
 * Service for scraping product data from e-commerce pages.
 * Uses Puppeteer for JavaScript-rendered pages and Cheerio for HTML parsing.
 */
export class WebScraperService {
  private readonly downloadDir: string;
  private readonly httpsAgent: https.Agent;

  constructor() {
    this.downloadDir = path.join(process.cwd(), 'public', 'product-images');
    this.httpsAgent = new https.Agent(HTTPS_CONFIG);
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

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

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
   * Main entry point: Scrapes product data from a URL
   */
  async scrapeProductPage(url: string): Promise<ProductData> {
    const validation = this.validateUrl(url);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    logRequest('WebScraper', 'scrapeProductPage', { url });
    console.log('\n  🤖 Using Puppeteer (headless browser)...');

    try {
      const productData = await this.scrapeWithPuppeteer(url);

      logResponse('WebScraper', 'scrapeProductPage', {
        url,
        productName: productData.name,
        imagesFound: productData.images?.length || 0,
        localImagesDownloaded: productData.localImagePaths?.length || 0,
      });

      return productData;
    } catch (error) {
      const errorMessage = (error as Error).message;
      console.log(`  ✗ Scraping failed: ${errorMessage}`);
      logError('WebScraper', 'scrapeProductPage', error as Error, { url });
      throw new Error(`Failed to scrape product page: ${errorMessage}`);
    }
  }

  /**
   * Gets the best quality main image for AI generation.
   * Prioritizes dimensions first, then quality score.
   */
  getBestMainImage(imageMetadata: ImageMetadata[]): ImageMetadata | undefined {
    const highResImages = imageMetadata.filter(
      img => Math.min(img.width, img.height) >= CONFIG.HIGH_RES_MIN_DIMENSION
    );

    if (highResImages.length > 0) {
      const mainImages = highResImages.filter(img => img.isMainProductImage);
      if (mainImages.length > 0) {
        return this.sortByDimensionsAndQuality(mainImages)[0];
      }

      const preferredViews = highResImages.filter(
        img => ['main', 'front', 'zoom'].includes(img.viewType)
      );
      if (preferredViews.length > 0) {
        return this.sortByDimensionsAndQuality(preferredViews)[0];
      }

      return this.sortByDimensionsAndQuality(highResImages)[0];
    }

    console.log('  ⚠ No high-resolution images (800px+) found, using best available');
    return this.sortByDimensionsAndQuality(imageMetadata)[0];
  }

  /**
   * Gets the best image for video generation.
   * Prioritizes dimensions first, then quality score.
   */
  getBestImageForVideo(imageMetadata: ImageMetadata[]): ImageMetadata | undefined {
    const highResImages = imageMetadata.filter(
      img => Math.min(img.width, img.height) >= CONFIG.HIGH_RES_MIN_DIMENSION
    );

    if (highResImages.length > 0) {
      const candidates = highResImages.filter(
        img => ['main', 'front', 'zoom'].includes(img.viewType)
      );
      return candidates.length > 0
        ? this.sortByDimensionsAndQuality(candidates)[0]
        : this.sortByDimensionsAndQuality(highResImages)[0];
    }

    const mediumRes = imageMetadata.filter(
      img => Math.min(img.width, img.height) >= CONFIG.MEDIUM_RES_MIN_DIMENSION
    );
    if (mediumRes.length > 0) {
      console.log('  ⚠ No high-res images for video, using medium resolution (512px+)');
      return this.sortByDimensionsAndQuality(mediumRes)[0];
    }

    console.log('  ⚠ No suitable resolution images for video, using best available');
    return this.sortByDimensionsAndQuality(imageMetadata)[0];
  }

  // ==========================================================================
  // PUPPETEER SCRAPING
  // ==========================================================================

  /**
   * Scrapes a page using Puppeteer headless browser
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
        `--user-agent=${USER_AGENT}`,
      ],
    });

    try {
      const page = await browser.newPage();
      await this.configurePage(page);

      console.log(`  📄 Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: CONFIG.PAGE_LOAD_TIMEOUT });
      console.log('  ✓ Page loaded successfully');

      await this.waitForDynamicContent(page);

      console.log('  📋 Extracting HTML content...');
      const html = await page.content();
      await browser.close();
      console.log('  ✓ Browser closed');

      console.log('  🔍 Parsing product data from HTML...');
      return this.parseProductPage(url, html);
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  private async configurePage(page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>): Promise<void> {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    });
  }

  private async waitForDynamicContent(page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>): Promise<void> {
    console.log('  ⏳ Waiting for dynamic content...');
    await this.sleep(CONFIG.DYNAMIC_CONTENT_WAIT);

    console.log('  📜 Scrolling to load lazy images...');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.sleep(CONFIG.LAZY_LOAD_WAIT);

    await page.evaluate(() => window.scrollTo(0, 0));
    await this.sleep(500);
  }

  // ==========================================================================
  // HTML PARSING
  // ==========================================================================

  private async parseProductPage(url: string, html: string): Promise<ProductData> {
    const $ = cheerio.load(html);

    const name = this.extractProductName($);
    if (!name) {
      throw new Error(
        "Unable to find product information on this page. Please make sure you're using a direct product page URL."
      );
    }

    const images = this.extractProductImages($);
    this.logExtractedImages(images);

    console.log(`\nExtracting and downloading up to ${images.length} product images with metadata...`);
    const { localImagePaths, imageMetadata } = await this.downloadImagesWithMetadata(images, url, $);
    this.logDownloadedImages(imageMetadata);

    return {
      url,
      name,
      description: this.extractProductDescription($) || '',
      images,
      localImagePaths,
      imageMetadata,
      price: this.extractProductPrice($),
      category: this.extractProductCategory($),
      brand: this.extractProductBrand($),
      extractedAt: new Date(),
    };
  }

  // ==========================================================================
  // PRODUCT DATA EXTRACTORS
  // ==========================================================================

  private extractProductName($: cheerio.CheerioAPI): string {
    const isAmazon = this.isAmazonPage($);
    if (isAmazon) {
      console.log('  [DEBUG] Detected Amazon page, trying Amazon-specific selectors...');
    }

    for (const selector of SELECTORS.productName) {
      const element = $(selector).first();
      if (!element.length) continue;

      const text = selector.startsWith('meta')
        ? element.attr('content')
        : element.text();

      if (!text) continue;

      const cleanText = this.cleanProductName(text);
      if (this.isValidProductName(cleanText)) {
        console.log(`  [DEBUG] Found product name via "${selector}": ${cleanText.substring(0, 50)}...`);
        return cleanText;
      }
    }

    // Fallback: page title
    const pageTitle = $('title').text().trim();
    if (pageTitle) {
      const cleanedTitle = this.cleanProductName(pageTitle);
      if (this.isValidProductName(cleanedTitle)) {
        console.log(`  [DEBUG] Extracted product name from page title: ${cleanedTitle.substring(0, 50)}...`);
        return cleanedTitle;
      }
    }

    console.log('  [DEBUG] Could not find product name with any selector');
    return '';
  }

  private extractProductDescription($: cheerio.CheerioAPI): string {
    for (const selector of SELECTORS.productDescription) {
      const element = $(selector).first();
      if (!element.length) continue;

      const text = selector.startsWith('meta')
        ? element.attr('content')
        : element.text();

      if (text) {
        return text.trim().substring(0, CONFIG.MAX_DESCRIPTION_LENGTH);
      }
    }
    return '';
  }

  private extractProductPrice($: cheerio.CheerioAPI): string | undefined {
    return this.extractFirstMatch($, SELECTORS.productPrice);
  }

  private extractProductCategory($: cheerio.CheerioAPI): string | undefined {
    for (const selector of SELECTORS.productCategory) {
      const elements = $(selector);
      if (!elements.length) continue;

      const categories: string[] = [];
      elements.each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.toLowerCase() !== 'home') {
          categories.push(text);
        }
      });

      if (categories.length) {
        return categories.join(' > ');
      }
    }
    return undefined;
  }

  private extractProductBrand($: cheerio.CheerioAPI): string | undefined {
    return this.extractFirstMatch($, SELECTORS.productBrand);
  }

  private extractFirstMatch($: cheerio.CheerioAPI, selectors: readonly string[]): string | undefined {
    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = element.text().trim();
        if (text) return text;
      }
    }
    return undefined;
  }

  // ==========================================================================
  // IMAGE EXTRACTION
  // ==========================================================================

  private extractProductImages($: cheerio.CheerioAPI): string[] {
    const images = new Set<string>();
    console.log('\n========== IMAGE EXTRACTION DEBUG ==========');

    for (const selector of SELECTORS.productImages) {
      const elements = $(selector);
      if (elements.length > 0) {
        console.log(`  Selector "${selector}" matched ${elements.length} elements`);
      }

      elements.each((_, element) => {
        const extracted = this.extractImageFromElement($, element, selector);
        extracted.forEach(url => images.add(url));
      });
    }

    console.log(`  Total unique images from selectors: ${images.size}`);

    // Fallback: large images
    if (images.size === 0) {
      this.extractFallbackImages($, images);
    }

    return Array.from(images).slice(0, 30);
  }

  private extractImageFromElement(
    $: cheerio.CheerioAPI,
    element: any,
    selector: string
  ): string[] {
    const images: string[] = [];
    const $el = $(element);

    if (selector.startsWith('meta')) {
      const content = $el.attr('content');
      if (content && this.isValidImageUrl(content)) {
        console.log(`    [meta] Found: ${content.substring(0, 80)}...`);
        images.push(content);
      }
      return images;
    }

    if (selector === 'picture source') {
      const srcset = $el.attr('srcset');
      if (srcset) {
        this.parseSrcset(srcset).forEach(img => {
          if (this.isValidImageUrl(img)) {
            const highRes = this.getHigherQualityUrl(img);
            console.log(`    [picture srcset] Found: ${highRes.substring(0, 80)}...`);
            images.push(highRes);
          }
        });
      }
      return images;
    }

    // Standard image attributes
    this.extractAmazonHighResImages($el, images);
    this.extractStandardImageAttributes($el, images);

    return images;
  }

  private extractAmazonHighResImages($el: any, images: string[]): void {
    const dataOldHires = $el.attr('data-old-hires');
    if (dataOldHires && this.isValidImageUrl(dataOldHires)) {
      console.log(`    [data-old-hires] Found: ${dataOldHires.substring(0, 80)}...`);
      images.push(dataOldHires);
    }

    const dataDynamicImage = $el.attr('data-a-dynamic-image');
    if (dataDynamicImage) {
      try {
        const dynamicImages = JSON.parse(dataDynamicImage);
        for (const imgUrl of Object.keys(dynamicImages)) {
          if (this.isValidImageUrl(imgUrl)) {
            console.log(`    [data-a-dynamic-image] Found: ${imgUrl.substring(0, 80)}...`);
            images.push(imgUrl);
          }
        }
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  private extractStandardImageAttributes($el: any, images: string[]): void {
    const attrs = ['src', 'data-src', 'data-image'];

    for (const attr of attrs) {
      const value = $el.attr(attr);
      if (value && this.isValidImageUrl(value)) {
        const highRes = this.getHigherQualityUrl(value);
        console.log(`    [${attr}] Found: ${highRes.substring(0, 80)}...`);
        images.push(highRes);
      }
    }

    const srcset = $el.attr('srcset');
    if (srcset) {
      const srcsetImages = this.parseSrcset(srcset);
      srcsetImages.forEach(img => images.push(this.getHigherQualityUrl(img)));
      if (srcsetImages.length > 0) {
        console.log(`    [srcset] Found ${srcsetImages.length} images`);
      }
    }
  }

  private extractFallbackImages($: cheerio.CheerioAPI, images: Set<string>): void {
    $('img').each((_, element) => {
      const src = $(element).attr('src');
      const width = parseInt($(element).attr('width') || '0', 10);
      const height = parseInt($(element).attr('height') || '0', 10);

      if (src && this.isValidImageUrl(src)) {
        if (width >= 200 || height >= 200 || (!width && !height)) {
          images.add(this.getHigherQualityUrl(src));
        }
      }
    });
  }

  // ==========================================================================
  // IMAGE DOWNLOADING & METADATA
  // ==========================================================================

  private async downloadImagesWithMetadata(
    imageUrls: string[],
    baseUrl: string,
    $: cheerio.CheerioAPI
  ): Promise<{ localImagePaths: string[]; imageMetadata: ImageMetadata[] }> {
    const localImagePaths: string[] = [];
    const imageMetadata: ImageMetadata[] = [];
    const maxToProcess = Math.min(imageUrls.length, CONFIG.MAX_IMAGES);

    console.log('\n========== DOWNLOADING IMAGES ==========');
    console.log(`Total URLs found: ${imageUrls.length}`);
    console.log(`Will process: ${maxToProcess} images`);

    for (let i = 0; i < maxToProcess; i++) {
      const result = await this.downloadSingleImage(imageUrls[i], baseUrl, i, maxToProcess, $);
      if (result) {
        localImagePaths.push(result.localPath);
        imageMetadata.push(result.metadata);
      }
    }

    console.log('\n========== DOWNLOAD COMPLETE ==========');
    console.log(`Successfully downloaded: ${imageMetadata.length}/${maxToProcess} images`);

    if (imageMetadata.length === 0) {
      throw new Error('Failed to download any product images.');
    }

    return { localImagePaths, imageMetadata };
  }

  private async downloadSingleImage(
    imageUrl: string,
    baseUrl: string,
    index: number,
    total: number,
    $: cheerio.CheerioAPI
  ): Promise<{ localPath: string; metadata: ImageMetadata } | null> {
    try {
      const resolvedUrl = this.resolveImageUrl(imageUrl, baseUrl);
      console.log(`\n  [${index + 1}/${total}] Starting download...`);
      console.log(`      URL: ${resolvedUrl.substring(0, 100)}...`);

      const response = await this.fetchImage(resolvedUrl, baseUrl);

      if (!this.isValidImageResponse(response)) {
        return null;
      }

      console.log(`      ✓ Downloaded ${response.data.length} bytes (HTTP ${response.status})`);

      const { filename, filePath, format } = this.saveImage(response);
      const metadata = await this.extractImageMetadata(filePath, resolvedUrl, response.data.length, format, index, $);

      console.log(`      ✓ Saved: ${filename}`);
      console.log(`        Size: ${metadata.width}x${metadata.height}, ${Math.round(metadata.fileSize / 1024)}KB`);
      console.log(`        Quality: ${metadata.qualityScore.toFixed(0)}, View: ${metadata.viewType}`);

      return { localPath: filePath, metadata };
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.warn(`      ✗ Failed image ${index + 1}: ${errorMsg.substring(0, 100)}`);
      return null;
    }
  }

  private resolveImageUrl(imageUrl: string, baseUrl: string): string {
    if (imageUrl.startsWith('http') || imageUrl.startsWith('data:')) {
      return imageUrl;
    }
    const base = new URL(baseUrl);
    return new URL(imageUrl, base.origin).toString();
  }

  private async fetchImage(imageUrl: string, baseUrl: string) {
    const imageUrlObj = new URL(imageUrl);
    const imageOrigin = `${imageUrlObj.protocol}//${imageUrlObj.host}`;

    return axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: CONFIG.IMAGE_DOWNLOAD_TIMEOUT,
      httpsAgent: this.httpsAgent,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': baseUrl,
        'Origin': imageOrigin,
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
      },
      maxRedirects: 5,
      validateStatus: status => status < 500,
    });
  }

  private isValidImageResponse(response: { status: number; data: Buffer }): boolean {
    if (response.status !== 200) {
      console.warn(`      ✗ HTTP ${response.status} - skipping`);
      return false;
    }

    if (!response.data || response.data.length < CONFIG.MIN_IMAGE_SIZE_BYTES) {
      console.warn(`      ✗ Response too small (${response.data?.length || 0} bytes) - likely not an image`);
      return false;
    }

    return true;
  }

  private saveImage(response: any) {
    const contentType = (response.headers?.['content-type'] || '') as string;
    const { extension, format } = this.determineImageFormat(contentType);

    const filename = `${uuidv4()}.${extension}`;
    const filePath = path.join(this.downloadDir, filename);

    fs.writeFileSync(filePath, response.data);

    return { filename, filePath, format };
  }

  private determineImageFormat(contentType: string): { extension: string; format: string } {
    if (contentType.includes('png')) return { extension: 'png', format: 'png' };
    if (contentType.includes('webp')) return { extension: 'webp', format: 'webp' };
    if (contentType.includes('gif')) return { extension: 'gif', format: 'gif' };
    return { extension: 'jpg', format: 'jpeg' };
  }

  // ==========================================================================
  // IMAGE METADATA
  // ==========================================================================

  private async extractImageMetadata(
    filePath: string,
    originalUrl: string,
    fileSize: number,
    format: string,
    index: number,
    $: cheerio.CheerioAPI
  ): Promise<ImageMetadata> {
    const metadata = await sharp(filePath).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    const viewType = this.determineViewType(originalUrl, index);
    const qualityScore = this.calculateQualityScore(width, height, fileSize, format, index, viewType);

    return {
      localPath: filePath,
      originalUrl,
      width,
      height,
      fileSize,
      format,
      viewType,
      qualityScore,
      isMainProductImage: this.isMainImage(index, viewType, qualityScore, width, height),
      sourceLocation: this.determineSourceLocation(originalUrl),
      downloadedAt: new Date(),
    };
  }

  private determineViewType(url: string, index: number): ImageViewType {
    const lowerUrl = url.toLowerCase();

    const viewPatterns: [RegExp, ImageViewType][] = [
      [/zoom|large|hi-res|full|xlarge/, 'zoom'],
      [/detail|closeup|close-up/, 'detail'],
      [/front|_f_|-f-/, 'front'],
      [/back|_b_|-b-|rear/, 'back'],
      [/side|_s_|-s-|left|right/, 'side'],
      [/lifestyle|context|scene|model|wear|use/, 'lifestyle'],
      [/alt|_[2-5]|-[2-5]/, 'alternate'],
    ];

    for (const [pattern, viewType] of viewPatterns) {
      if (pattern.test(lowerUrl)) {
        return viewType;
      }
    }

    return index === 0 ? 'main' : 'alternate';
  }

  private calculateQualityScore(
    width: number,
    height: number,
    fileSize: number,
    format: string,
    index: number,
    viewType: ImageViewType
  ): number {
    let score = 0;

    // Dimensions (0-60) - highest priority
    score += this.calculateDimensionScore(width, height);

    // Aspect ratio (0-10)
    const aspectRatio = width / height;
    if (aspectRatio >= 0.8 && aspectRatio <= 1.25) score += 10;
    else if (aspectRatio >= 0.6 && aspectRatio <= 1.67) score += 7;
    else score += 3;

    // File size (0-10)
    if (fileSize >= 500000) score += 10;
    else if (fileSize >= 200000) score += 8;
    else if (fileSize >= 100000) score += 6;
    else if (fileSize >= 50000) score += 4;
    else score += 2;

    // Format (0-5)
    const formatScores: Record<string, number> = { png: 5, webp: 4, jpeg: 3 };
    score += formatScores[format] || 2;

    // Position (0-5)
    if (index === 0) score += 5;
    else if (index <= 2) score += 4;
    else if (index <= 5) score += 3;
    else score += 2;

    // View type (0-10)
    const viewScores: Record<ImageViewType, number> = {
      main: 10, zoom: 9, front: 8, detail: 6,
      back: 3, side: 3, lifestyle: 3, alternate: 3, unknown: 2,
    };
    score += viewScores[viewType] || 3;

    return Math.min(100, score);
  }

  private calculateDimensionScore(width: number, height: number): number {
    let score = 0;
    const pixels = width * height;
    const minDimension = Math.min(width, height);

    // Pixel score (0-35)
    if (pixels >= 4000000) score += 35;
    else if (pixels >= 2500000) score += 32;
    else if (pixels >= 1500000) score += 28;
    else if (pixels >= 1000000) score += 24;
    else if (pixels >= 500000) score += 18;
    else if (pixels >= 250000) score += 12;
    else if (pixels >= 100000) score += 6;
    else score += 2;

    // Min dimension score (0-25)
    if (minDimension >= 1500) score += 25;
    else if (minDimension >= 1000) score += 20;
    else if (minDimension >= 800) score += 15;
    else if (minDimension >= 600) score += 10;
    else if (minDimension >= 400) score += 5;
    else score += 1;

    return score;
  }

  private isMainImage(
    index: number,
    viewType: ImageViewType,
    qualityScore: number,
    width: number,
    height: number
  ): boolean {
    if (index === 0 && qualityScore >= 50) return true;
    if (viewType === 'main' && qualityScore >= 50) return true;
    if (viewType === 'front' && width >= 800 && height >= 800 && qualityScore >= 60) return true;
    return false;
  }

  private determineSourceLocation(url: string): string {
    const lowerUrl = url.toLowerCase();

    if (/thumb|small|mini/.test(lowerUrl)) return 'thumbnail';
    if (/zoom|large|full|hi-res/.test(lowerUrl)) return 'zoom';
    if (/cdn|cloudfront|akamai/.test(lowerUrl)) return 'cdn';
    if (/gallery|carousel/.test(lowerUrl)) return 'gallery';

    return 'page';
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  private sortByDimensionsAndQuality(images: ImageMetadata[]): ImageMetadata[] {
    return [...images].sort((a, b) => {
      const aMinDim = Math.min(a.width, a.height);
      const bMinDim = Math.min(b.width, b.height);

      if (Math.abs(aMinDim - bMinDim) > 200) {
        return bMinDim - aMinDim;
      }
      return b.qualityScore - a.qualityScore;
    });
  }

  private isAmazonPage($: cheerio.CheerioAPI): boolean {
    return (
      $('link[rel="canonical"]').attr('href')?.includes('amazon') ||
      $('meta[property="og:site_name"]').attr('content')?.toLowerCase().includes('amazon') ||
      false
    );
  }

  private cleanProductName(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\s*[-|:]\s*(Amazon|Amazon\.com).*$/i, '')
      .replace(/^\s*(Amazon\.com\s*[-|:]\s*)/i, '')
      .trim();
  }

  private isValidProductName(text: string): boolean {
    if (!text || text.length < 3 || text.length > 500) return false;

    for (const pattern of INVALID_NAME_PATTERNS) {
      if (pattern.test(text)) {
        console.log(`  [DEBUG] Rejected text matching pattern: ${text.substring(0, 50)}...`);
        return false;
      }
    }
    return true;
  }

  private isValidImageUrl(url: string): boolean {
    if (!url) return false;

    if (url.startsWith('data:')) {
      return url.length > 1000;
    }

    const lowerUrl = url.toLowerCase();
    return !PLACEHOLDER_PATTERNS.some(pattern => lowerUrl.includes(pattern));
  }

  private parseSrcset(srcset: string): string[] {
    return srcset
      .split(',')
      .map(part => part.trim().split(/\s+/)[0])
      .filter(url => url && this.isValidImageUrl(url));
  }

  private getHigherQualityUrl(url: string): string {
    // Amazon transformations
    if (url.includes('media-amazon.com') || url.includes('amazon.com')) {
      return url
        .replace(/_AC_SR\d+,\d+_/g, '_AC_SL1500_')
        .replace(/_S[XY]\d+_/g, '_SL1500_')
        .replace(/_AC_S[XY]\d+_/g, '_AC_SL1500_')
        .replace(/_US\d+_/g, '_SL1500_')
        .replace(/_CR\d+,\d+,\d+,\d+_/g, '')
        .replace(/_QL\d+_/g, '_QL100_')
        .replace(/_FMwebp_/g, '_')
        .replace(/\._[^.]+_\./g, '._SL1500_.');
    }

    // Nike transformations
    if (url.includes('nike.com')) {
      return url
        .replace(/t_default/g, 't_PDP_1728_v1')
        .replace(/t_thumb/g, 't_PDP_1728_v1');
    }

    // Generic transformations
    return url
      .replace(/w_\d+/, 'w_2000')
      .replace(/h_\d+/, 'h_2000')
      .replace(/q_\d+/, 'q_90')
      .replace(/_small/g, '_large')
      .replace(/_thumb/g, '_large')
      .replace(/_medium/g, '_large')
      .replace(/\/small\//g, '/large/')
      .replace(/\/thumb\//g, '/large/')
      .replace(/\/medium\//g, '/large/');
  }

  private logExtractedImages(images: string[]): void {
    console.log(`\n========== EXTRACTED IMAGE URLs (${images.length} found) ==========`);
    images.forEach((imgUrl, idx) => {
      console.log(`  ${idx + 1}. ${imgUrl.substring(0, 150)}${imgUrl.length > 150 ? '...' : ''}`);
    });
    console.log('='.repeat(60));
  }

  private logDownloadedImages(imageMetadata: ImageMetadata[]): void {
    if (imageMetadata.length > 0) {
      console.log(`\n✓ Successfully processed ${imageMetadata.length} images:`);
      const sortedByQuality = this.sortByDimensionsAndQuality(imageMetadata);
      const topImages = sortedByQuality.slice(0, 5);
      console.log('  Top 5 quality images:');
      topImages.forEach((img, idx) => {
        console.log(
          `  ${idx + 1}. ${img.width}x${img.height}, ${Math.round(img.fileSize / 1024)}KB, ` +
          `quality: ${img.qualityScore.toFixed(0)}, view: ${img.viewType}`
        );
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const webScraperService = new WebScraperService();
