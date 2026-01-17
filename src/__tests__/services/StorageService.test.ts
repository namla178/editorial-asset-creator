import { StorageService } from '@/services/StorageService';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    service = new StorageService();
  });

  describe('createJob', () => {
    it('should create a job with unique ID', () => {
      const job = service.createJob('https://example.com/product');

      expect(job.id).toBeDefined();
      expect(job.id.length).toBeGreaterThan(0);
      expect(job.productUrl).toBe('https://example.com/product');
      expect(job.status).toBe('pending');
      expect(job.progress).toBe(0);
      expect(job.assets).toEqual([]);
      expect(job.createdAt).toBeInstanceOf(Date);
    });

    it('should create jobs with different IDs', () => {
      const job1 = service.createJob('https://example.com/product1');
      const job2 = service.createJob('https://example.com/product2');

      expect(job1.id).not.toBe(job2.id);
    });
  });

  describe('getJob', () => {
    it('should retrieve a created job', () => {
      const createdJob = service.createJob('https://example.com/product');
      const retrievedJob = service.getJob(createdJob.id);

      expect(retrievedJob).toBeDefined();
      expect(retrievedJob?.id).toBe(createdJob.id);
      expect(retrievedJob?.productUrl).toBe(createdJob.productUrl);
    });

    it('should return undefined for non-existent job', () => {
      const job = service.getJob('non-existent-id');
      expect(job).toBeUndefined();
    });
  });

  describe('updateJob', () => {
    it('should update job status', () => {
      const job = service.createJob('https://example.com/product');
      
      const updatedJob = service.updateJob(job.id, {
        status: 'scraping',
        progress: 25,
        currentStep: 'Extracting product data',
      });

      expect(updatedJob?.status).toBe('scraping');
      expect(updatedJob?.progress).toBe(25);
      expect(updatedJob?.currentStep).toBe('Extracting product data');
    });

    it('should return undefined for non-existent job', () => {
      const result = service.updateJob('non-existent-id', { status: 'completed' });
      expect(result).toBeUndefined();
    });
  });

  describe('createAsset', () => {
    it('should create an asset record', () => {
      const job = service.createJob('https://example.com/product');
      
      const asset = service.createAsset(
        job.id,
        'image',
        '/path/to/image.png',
        'Test Image',
        'A test image description'
      );

      expect(asset.id).toBeDefined();
      expect(asset.jobId).toBe(job.id);
      expect(asset.type).toBe('image');
      expect(asset.title).toBe('Test Image');
      expect(asset.description).toBe('A test image description');
      expect(asset.metadata.format).toBe('png');
    });

    it('should create video asset with correct format', () => {
      const job = service.createJob('https://example.com/product');
      
      const asset = service.createAsset(
        job.id,
        'video',
        '/path/to/video.mp4',
        'Test Video',
        'A test video description'
      );

      expect(asset.type).toBe('video');
      expect(asset.metadata.format).toBe('mp4');
    });
  });

  describe('addAssetToJob', () => {
    it('should add asset to job', () => {
      const job = service.createJob('https://example.com/product');
      const asset = service.createAsset(
        job.id,
        'image',
        '/path/to/image.png',
        'Test Image',
        'Description'
      );

      const updatedJob = service.addAssetToJob(job.id, asset);

      expect(updatedJob?.assets.length).toBe(1);
      expect(updatedJob?.assets[0].id).toBe(asset.id);
    });
  });

  describe('generateFilename', () => {
    it('should generate unique filenames', () => {
      const filename1 = service.generateFilename('image', 'png');
      const filename2 = service.generateFilename('image', 'png');

      expect(filename1).not.toBe(filename2);
      expect(filename1).toMatch(/^image_[a-f0-9-]+\.png$/);
    });
  });
});
