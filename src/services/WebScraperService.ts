import * as cheerio from 'cheerio';
import axios, { AxiosError } from 'axios';
import { ProductData } from '@/types';

/**
 * Service for scraping product data from e-commerce pages
 */
export class WebScraperService {
  private readonly timeout = 30000; // 30 seconds
  private readonly maxRetries = 3;
  private readonly userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.attemptScrape(url);
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`Failed to scrape product page after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Attempts to scrape a product page
   */
  private async attemptScrape(url: string): Promise<ProductData> {
    try {
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });

      const html = response.data;
      return this.parseProductPage(url, html);
    } catch (error) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response) {
        const status = axiosError.response.status;
        if (status === 404) {
          throw new Error('Product page not found (404)');
        } else if (status === 403) {
          throw new Error('Access denied to product page (403)');
        } else if (status >= 500) {
          throw new Error(`Server error (${status})`);
        }
      } else if (axiosError.code === 'ECONNABORTED') {
        throw new Error('Request timed out');
      }
      
      throw error;
    }
  }

  /**
   * Parses HTML to extract product data
   */
  private parseProductPage(url: string, html: string): ProductData {
    const $ = cheerio.load(html);

    const name = this.extractProductName($);
    const description = this.extractProductDescription($);
    const images = this.extractProductImages($);
    const price = this.extractProductPrice($);
    const category = this.extractProductCategory($);
    const brand = this.extractProductBrand($);

    if (!name) {
      throw new Error('Could not extract product name from page');
    }

    return {
      url,
      name,
      description: description || '',
      images,
      price,
      category,
      brand,
      extractedAt: new Date(),
    };
  }

  /**
   * Extracts product name from common selectors
   */
  private extractProductName($: cheerio.CheerioAPI): string {
    const selectors = [
      // Common e-commerce selectors
      '[data-testid="product-title"]',
      '[data-testid="product-name"]',
      '.product-title',
      '.product-name',
      '#productTitle',
      '#product-title',
      'h1.title',
      'h1[itemprop="name"]',
      '[itemprop="name"]',
      '.pdp-product-title',
      '.product-single__title',
      // Generic fallbacks
      'h1',
      'meta[property="og:title"]',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        if (selector.startsWith('meta')) {
          const content = element.attr('content');
          if (content) return content.trim();
        } else {
          const text = element.text().trim();
          if (text) return text;
        }
      }
    }

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

    const selectors = [
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
      '#imageBlock img',
    ];

    for (const selector of selectors) {
      const elements = $(selector);
      elements.each((_, element) => {
        if (selector.startsWith('meta')) {
          const content = $(element).attr('content');
          if (content && this.isValidImageUrl(content)) {
            images.add(content);
          }
        } else {
          // Check multiple image sources
          const src = $(element).attr('src');
          const dataSrc = $(element).attr('data-src');
          const srcset = $(element).attr('srcset');

          if (src && this.isValidImageUrl(src)) {
            images.add(src);
          }
          if (dataSrc && this.isValidImageUrl(dataSrc)) {
            images.add(dataSrc);
          }
          if (srcset) {
            const srcsetImages = this.parseSrcset(srcset);
            srcsetImages.forEach(img => images.add(img));
          }
        }
      });
    }

    // Fallback: get any large images on the page
    if (images.size === 0) {
      $('img').each((_, element) => {
        const src = $(element).attr('src');
        const width = parseInt($(element).attr('width') || '0', 10);
        const height = parseInt($(element).attr('height') || '0', 10);

        if (src && this.isValidImageUrl(src)) {
          if (width >= 200 || height >= 200 || (!width && !height)) {
            images.add(src);
          }
        }
      });
    }

    return Array.from(images).slice(0, 10); // Limit to 10 images
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
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const webScraperService = new WebScraperService();
