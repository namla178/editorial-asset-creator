import { WebScraperService } from '@/services/WebScraperService';

describe('WebScraperService', () => {
  let service: WebScraperService;

  beforeEach(() => {
    service = new WebScraperService();
  });

  describe('validateUrl', () => {
    it('should return valid for a valid HTTP URL', () => {
      const result = service.validateUrl('http://example.com/product');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return valid for a valid HTTPS URL', () => {
      const result = service.validateUrl('https://example.com/product');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid for empty string', () => {
      const result = service.validateUrl('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL is required');
    });

    it('should return invalid for invalid URL format', () => {
      const result = service.validateUrl('not-a-url');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid URL format');
    });

    it('should return invalid for FTP protocol', () => {
      const result = service.validateUrl('ftp://example.com/file');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL must use HTTP or HTTPS protocol');
    });

    it('should return invalid for file protocol', () => {
      const result = service.validateUrl('file:///path/to/file');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('URL must use HTTP or HTTPS protocol');
    });

    it('should handle URL with query parameters', () => {
      const result = service.validateUrl('https://example.com/product?id=123&ref=search');
      expect(result.valid).toBe(true);
    });

    it('should handle URL with fragment', () => {
      const result = service.validateUrl('https://example.com/product#details');
      expect(result.valid).toBe(true);
    });
  });

  describe('scrapeProductPage', () => {
    it('should throw error for invalid URL', async () => {
      await expect(service.scrapeProductPage('invalid-url')).rejects.toThrow('Invalid URL format');
    });

    it('should throw error for empty URL', async () => {
      await expect(service.scrapeProductPage('')).rejects.toThrow('URL is required');
    });
  });
});
