import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { GenerationJob, GeneratedAsset } from '@/types';

// Declare global type for Node.js global object
declare global {
  var jobStore: Map<string, GenerationJob> | undefined;
}

// Use global job store to persist across hot reloads in development
const jobStore = global.jobStore || new Map<string, GenerationJob>();
if (!global.jobStore) {
  global.jobStore = jobStore;
}

/**
 * Service for managing generated assets and job storage
 */
export class StorageService {
  private readonly publicDir: string;
  private readonly generatedDir: string;

  constructor() {
    this.publicDir = path.join(process.cwd(), 'public');
    this.generatedDir = path.join(this.publicDir, 'generated');
    this.ensureDirectories();
  }

  /**
   * Ensures required directories exist
   */
  private ensureDirectories(): void {
    if (!fs.existsSync(this.generatedDir)) {
      fs.mkdirSync(this.generatedDir, { recursive: true });
    }
  }

  /**
   * Creates a new generation job
   */
  createJob(productUrl: string): GenerationJob {
    const job: GenerationJob = {
      id: uuidv4(),
      productUrl,
      status: 'pending',
      progress: 0,
      currentStep: 'Initializing...',
      assets: [],
      createdAt: new Date(),
    };

    jobStore.set(job.id, job);
    return job;
  }

  /**
   * Retrieves a job by ID
   */
  getJob(jobId: string): GenerationJob | undefined {
    return jobStore.get(jobId);
  }

  /**
   * Updates a job's status and progress
   */
  updateJob(jobId: string, updates: Partial<GenerationJob>): GenerationJob | undefined {
    const job = jobStore.get(jobId);
    if (!job) return undefined;

    const updatedJob = { ...job, ...updates };
    jobStore.set(jobId, updatedJob);
    return updatedJob;
  }

  /**
   * Adds an asset to a job
   */
  addAssetToJob(jobId: string, asset: GeneratedAsset): GenerationJob | undefined {
    const job = jobStore.get(jobId);
    if (!job) return undefined;

    job.assets.push(asset);
    jobStore.set(jobId, job);
    return job;
  }

  /**
   * Creates a new asset record
   */
  createAsset(
    jobId: string,
    type: 'image' | 'video',
    filePath: string,
    title: string,
    description: string
  ): GeneratedAsset {
    const filename = path.basename(filePath);
    const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    
    // Read actual image dimensions for images
    let width = 3072;  // Default for new high-res images
    let height = 3072;
    
    if (type === 'image' && fs.existsSync(filePath)) {
      try {
        const sharp = require('sharp');
        const metadata = sharp(filePath).metadata();
        metadata.then((info: any) => {
          width = info.width || 3072;
          height = info.height || 3072;
        }).catch(() => {
          // Keep defaults if metadata read fails
        });
      } catch {
        // Keep defaults if sharp fails
      }
    } else if (type === 'video') {
      width = 1024;
      height = 1024;
    }

    const asset: GeneratedAsset = {
      id: uuidv4(),
      jobId,
      type,
      url: `/generated/${jobId}/${filename}`,
      filePath,
      title,
      description,
      metadata: {
        format: type === 'image' ? 'png' : 'mp4',
        size: stats?.size || 0,
        width,
        height,
      },
      createdAt: new Date(),
    };

    return asset;
  }

  /**
   * Saves file data to storage
   */
  async saveFile(data: Buffer, filename: string): Promise<string> {
    const filePath = path.join(this.generatedDir, filename);
    fs.writeFileSync(filePath, data);
    return filePath;
  }

  /**
   * Retrieves a file from storage
   */
  getFile(assetId: string): { buffer: Buffer; filename: string; mimeType: string } | null {
    // Find the asset across all jobs
    for (const job of Array.from(jobStore.values())) {
      const asset = job.assets.find((a: GeneratedAsset) => a.id === assetId);
      if (asset && fs.existsSync(asset.filePath)) {
        const buffer = fs.readFileSync(asset.filePath);
        const filename = path.basename(asset.filePath);
        const mimeType = asset.type === 'image' ? 'image/png' : 'video/mp4';
        
        return { buffer, filename, mimeType };
      }
    }

    return null;
  }

  /**
   * Gets file path for an asset
   */
  getAssetFilePath(assetId: string): string | null {
    for (const job of Array.from(jobStore.values())) {
      const asset = job.assets.find((a: GeneratedAsset) => a.id === assetId);
      if (asset) {
        return asset.filePath;
      }
    }
    return null;
  }

  /**
   * Deletes old or failed jobs
   */
  cleanupOldJobs(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let deletedCount = 0;

    for (const [jobId, job] of Array.from(jobStore.entries())) {
      const jobAge = now - job.createdAt.getTime();
      
      if (jobAge > maxAgeMs || job.status === 'failed') {
        // Delete associated files
        for (const asset of job.assets) {
          if (fs.existsSync(asset.filePath)) {
            try {
              fs.unlinkSync(asset.filePath);
            } catch (error) {
              console.error(`Failed to delete file: ${asset.filePath}`, error);
            }
          }
        }

        jobStore.delete(jobId);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Gets all jobs (for debugging/admin)
   */
  getAllJobs(): GenerationJob[] {
    return Array.from(jobStore.values());
  }

  /**
   * Generates a unique filename
   */
  generateFilename(prefix: string, extension: string): string {
    return `${prefix}_${uuidv4()}.${extension}`;
  }
}

// Export singleton instance
export const storageService = new StorageService();
