'use client';

import React from 'react';
import { JobStatus } from '@/types';

interface ProgressIndicatorProps {
  status: JobStatus;
  progress: number;
  currentStep: string;
  isVisible: boolean;
}

/**
 * Progress indicator for the generation pipeline
 */
export function ProgressIndicator({
  status,
  progress,
  currentStep,
  isVisible,
}: ProgressIndicatorProps) {
  if (!isVisible) {
    return null;
  }

  const steps = [
    { id: 'scraping', label: 'Extracting Product Data', icon: '🔍' },
    { id: 'generating_brief', label: 'Creating Design Brief', icon: '📝' },
    { id: 'generating_assets', label: 'Generating Assets', icon: '🎨' },
    { id: 'completed', label: 'Complete', icon: '✅' },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === status);

  return (
    <section className="w-full max-w-3xl mx-auto p-6">
      <div className="bg-dark-card border border-dark-border rounded-xl p-6">
        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-white font-medium">{currentStep}</span>
            <span className="text-gray-400">{progress}%</span>
          </div>
          <div className="h-2 bg-dark-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent-purple to-accent-blue transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex justify-between">
          {steps.map((step, index) => {
            const isActive = index === currentStepIndex;
            const isComplete = index < currentStepIndex;
            const isPending = index > currentStepIndex;

            return (
              <div
                key={step.id}
                className={`flex flex-col items-center ${
                  isPending ? 'opacity-40' : ''
                }`}
              >
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center text-lg
                    ${isComplete ? 'bg-green-500' : ''}
                    ${isActive ? 'bg-accent-purple animate-pulse' : ''}
                    ${isPending ? 'bg-dark-border' : ''}
                  `}
                >
                  {step.icon}
                </div>
                <span
                  className={`mt-2 text-xs text-center max-w-[80px] ${
                    isActive ? 'text-white' : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Status message for errors */}
        {status === 'failed' && (
          <div className="mt-4 p-4 bg-red-900/20 border border-red-500/50 rounded-lg">
            <p className="text-red-400 text-center">
              Generation failed. Please try again.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default ProgressIndicator;
