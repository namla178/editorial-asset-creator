'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { InputSection } from '@/components/InputSection';
import { OutputSection } from '@/components/OutputSection';
import { DesignBriefDisplay } from '@/components/DesignBriefDisplay';
import { ProgressIndicator } from '@/components/ProgressIndicator';
import { GenerationJob, GeneratedAsset, JobStatus } from '@/types';
import { StatusResponse, GenerateResponse } from '@/types/api';

/**
 * Main application page for Editorial Asset Creator
 */
export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [jobId, setJobId] = useState<string>('');
  const [status, setStatus] = useState<JobStatus>('pending');
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [designBrief, setDesignBrief] = useState<GenerationJob['designBrief']>();
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [productUrl, setProductUrl] = useState('');
  const [lastOptions, setLastOptions] = useState<{ includeVideo: boolean }>({ includeVideo: true });
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Handles form submission
   */
  const handleSubmit = useCallback(async (url: string, options: { includeVideo: boolean }) => {
    setIsLoading(true);
    setError('');
    setJobId('');
    setStatus('pending');
    setProgress(0);
    setCurrentStep('');
    setDesignBrief(undefined);
    setAssets([]);
    setProductUrl(url);
    setLastOptions(options);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          productUrl: url,
          options: {
            includeVideo: options.includeVideo,
            imageCount: 1
          }
        }),
      });

      const data: GenerateResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start generation');
      }

      setJobId(data.jobId);
      startPolling(data.jobId);
    } catch (err) {
      setError((err as Error).message);
      setIsLoading(false);
    }
  }, []);

  /**
   * Starts polling for job status
   */
  const startPolling = useCallback((id: string) => {
    // Clear any existing interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/status/${id}`);
        const data: StatusResponse = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to get status');
        }

        setStatus(data.status);
        setProgress(data.progress);
        setCurrentStep(data.currentStep);

        if (data.designBrief) {
          setDesignBrief(data.designBrief);
        }

        if (data.assets && data.assets.length > 0) {
          setAssets(data.assets);
        }

        // Stop polling when complete or failed
        if (data.status === 'completed' || data.status === 'failed') {
          stopPolling();
          setIsLoading(false);

          if (data.status === 'failed') {
            setError(data.error || 'Generation failed');
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
        // Don't stop polling on network errors, just log them
      }
    };

    // Poll immediately and then every 2 seconds
    pollStatus();
    pollingIntervalRef.current = setInterval(pollStatus, 2000);
  }, []);

  /**
   * Stops polling
   */
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  /**
   * Handles downloading a single asset
   */
  const handleDownload = useCallback(async (assetId: string) => {
    try {
      const response = await fetch(`/api/download/${assetId}`);
      
      if (!response.ok) {
        throw new Error('Failed to download asset');
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || 'asset.png';

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      setError('Failed to download asset');
    }
  }, []);

  /**
   * Handles downloading all assets
   */
  const handleDownloadAll = useCallback(async () => {
    for (const asset of assets) {
      await handleDownload(asset.id);
      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }, [assets, handleDownload]);

  /**
   * Handles regeneration
   */
  const handleRegenerate = useCallback(() => {
    if (productUrl) {
      handleSubmit(productUrl, lastOptions);
    }
  }, [productUrl, lastOptions, handleSubmit]);

  const showProgress = isLoading && status !== 'pending';
  const showDesignBrief = designBrief !== undefined;
  const showOutput = assets.length > 0 && status === 'completed';

  return (
    <main className="min-h-screen bg-dark-bg py-12">
      {/* Input Section */}
      <InputSection
        onSubmit={handleSubmit}
        isLoading={isLoading}
        error={error}
      />

      {/* Progress Indicator */}
      <ProgressIndicator
        status={status}
        progress={progress}
        currentStep={currentStep}
        isVisible={showProgress}
      />

      {/* Design Brief Display */}
      <DesignBriefDisplay
        brief={designBrief}
        isVisible={showDesignBrief}
      />

      {/* Output Section */}
      <OutputSection
        assets={assets}
        onDownload={handleDownload}
        onDownloadAll={handleDownloadAll}
        onRegenerate={handleRegenerate}
        isVisible={showOutput}
      />
    </main>
  );
}
