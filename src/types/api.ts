import { ProductData, DesignBrief, GeneratedAsset, GenerationJob } from './index';

/**
 * Request to generate editorial assets
 */
export interface GenerateRequest {
  productUrl: string;
  options?: GenerateOptions;
}

/**
 * Generation options
 */
export interface GenerateOptions {
  includeVideo: boolean;
  imageCount: number;
}

/**
 * Response from generate endpoint
 */
export interface GenerateResponse {
  jobId: string;
  status: GenerationJob['status'];
  productData?: ProductData;
  designBrief?: DesignBrief;
  assets?: GeneratedAsset[];
  error?: string;
}

/**
 * Response from status endpoint
 */
export interface StatusResponse {
  jobId: string;
  status: GenerationJob['status'];
  progress: number;
  currentStep: string;
  productData?: ProductData;
  designBrief?: DesignBrief;
  assets?: GeneratedAsset[];
  error?: string;
}

/**
 * Error response format
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    retryable: boolean;
  };
}
