'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { StatusResponse } from '@/types/api';

interface UseStatusPollingOptions {
  interval?: number;
  onComplete?: (data: StatusResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Custom hook for polling job status
 */
export function useStatusPolling(
  jobId: string | null,
  options: UseStatusPollingOptions = {}
) {
  const { interval = 2000, onComplete, onError } = options;
  
  const [data, setData] = useState<StatusResponse | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!jobId) return;

    try {
      const response = await fetch(`/api/status/${jobId}`);
      const statusData: StatusResponse = await response.json();

      if (!response.ok) {
        throw new Error(statusData.error || 'Failed to fetch status');
      }

      setData(statusData);
      setError(null);

      // Stop polling when complete or failed
      if (statusData.status === 'completed' || statusData.status === 'failed') {
        stopPolling();
        onComplete?.(statusData);
      }
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
    }
  }, [jobId, stopPolling, onComplete, onError]);

  const startPolling = useCallback(() => {
    if (!jobId || intervalRef.current) return;

    setIsPolling(true);
    fetchStatus(); // Initial fetch
    
    intervalRef.current = setInterval(fetchStatus, interval);
  }, [jobId, interval, fetchStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    data,
    error,
    isPolling,
    startPolling,
    stopPolling,
  };
}

export default useStatusPolling;
