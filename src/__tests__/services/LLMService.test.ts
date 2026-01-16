import { LLMService } from '@/services/LLMService';
import { ProductData } from '@/types';

// Mock OpenAI
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

describe('LLMService', () => {
  let service: LLMService;

  const mockProductData: ProductData = {
    url: 'https://example.com/product',
    name: 'Test Product',
    description: 'A great product for testing',
    images: ['https://example.com/image.jpg'],
    price: '$99.99',
    category: 'Electronics',
    brand: 'TestBrand',
    extractedAt: new Date(),
  };

  beforeEach(() => {
    service = new LLMService();
  });

  describe('generateDesignBrief', () => {
    it('should generate a fallback brief when API fails', async () => {
      // The service should fall back to template-based generation
      // when the OpenAI API is not configured
      const brief = await service.generateDesignBrief(mockProductData);

      expect(brief).toBeDefined();
      expect(brief.productName).toBe(mockProductData.name);
      expect(brief.visualStyle).toBeDefined();
      expect(brief.messaging).toBeDefined();
      expect(brief.targetAudience).toBeDefined();
      expect(brief.colorPalette).toBeInstanceOf(Array);
      expect(brief.mood).toBeDefined();
      expect(brief.keyFeatures).toBeInstanceOf(Array);
      expect(brief.callToAction).toBeDefined();
      expect(brief.imagePrompt).toBeDefined();
      expect(brief.generatedAt).toBeInstanceOf(Date);
    });

    it('should include product name in messaging', async () => {
      const brief = await service.generateDesignBrief(mockProductData);
      
      expect(brief.messaging).toContain(mockProductData.name);
    });

    it('should include product name in image prompt', async () => {
      const brief = await service.generateDesignBrief(mockProductData);
      
      expect(brief.imagePrompt).toContain(mockProductData.name);
    });
  });
});
