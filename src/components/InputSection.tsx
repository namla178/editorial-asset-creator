'use client';

import React, { useState, FormEvent } from 'react';

interface GenerationOptions {
  includeVideo: boolean;
}

interface InputSectionProps {
  onSubmit: (url: string, options: GenerationOptions) => Promise<void>;
  isLoading: boolean;
  error?: string;
}

/**
 * Input section component for entering product URL
 */
export function InputSection({ onSubmit, isLoading, error }: InputSectionProps) {
  const [url, setUrl] = useState('');
  const [validationError, setValidationError] = useState('');
  const [includeVideo, setIncludeVideo] = useState(true);

  const validateUrl = (value: string): boolean => {
    if (!value) {
      setValidationError('Please enter a URL');
      return false;
    }

    try {
      const parsedUrl = new URL(value);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        setValidationError('URL must use HTTP or HTTPS protocol');
        return false;
      }
      setValidationError('');
      return true;
    } catch {
      setValidationError('Please enter a valid URL');
      return false;
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!validateUrl(url)) {
      return;
    }

    await onSubmit(url, { includeVideo });
  };

  const handleUrlChange = (value: string) => {
    setUrl(value);
    if (validationError) {
      validateUrl(value);
    }
  };

  const displayError = validationError || error;

  return (
    <section className="w-full max-w-3xl mx-auto p-6">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white mb-4">
          Editorial Asset Creator
        </h1>
        <p className="text-gray-400 text-lg">
          Transform any product page into stunning commercial advertising content
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <label htmlFor="productUrl" className="sr-only">
            Product URL
          </label>
          <input
            id="productUrl"
            type="url"
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="Enter product page URL (e.g., https://example.com/product)"
            disabled={isLoading}
            className={`
              w-full px-6 py-4 
              bg-dark-card border border-dark-border 
              rounded-xl text-white placeholder-gray-500
              focus:outline-none focus:ring-2 focus:ring-accent-purple focus:border-transparent
              transition-all duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              ${displayError ? 'border-red-500' : ''}
            `}
          />
        </div>

        {displayError && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>{displayError}</span>
          </div>
        )}

        {/* Video generation toggle */}
        <div className="flex items-center gap-3 p-4 bg-dark-card border border-dark-border rounded-xl">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={includeVideo}
              onChange={(e) => setIncludeVideo(e.target.checked)}
              disabled={isLoading}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent-purple rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent-purple"></div>
          </label>
          <div className="flex flex-col">
            <span className="text-white font-medium">Generate Video</span>
            <span className="text-gray-400 text-sm">Create an editorial video from the generated image</span>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading || !url}
          className={`
            w-full py-4 px-6 
            bg-gradient-to-r from-accent-purple to-accent-blue
            text-white font-semibold text-lg
            rounded-xl
            hover:opacity-90 
            focus:outline-none focus:ring-2 focus:ring-accent-purple focus:ring-offset-2 focus:ring-offset-dark-bg
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            flex items-center justify-center gap-3
          `}
        >
          {isLoading ? (
            <>
              <LoadingSpinner />
              <span>Generating Assets...</span>
            </>
          ) : (
            <>
              <SparklesIcon />
              <span>Generate Editorial Assets</span>
            </>
          )}
        </button>

        <p className="text-center text-gray-500 text-sm">
          Example: https://www.amazon.com/dp/B09V3KXJPB or any e-commerce product page
        </p>
      </form>
    </section>
  );
}

/**
 * Loading spinner component
 */
function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-5 w-5"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/**
 * Sparkles icon component
 */
function SparklesIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="currentColor"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744l.99 3.465 3.488.987a1 1 0 010 1.928l-3.488.987-.99 3.465a1 1 0 01-1.934 0l-.99-3.465-3.488-.987a1 1 0 010-1.928l3.488-.987.99-3.465A1 1 0 0112 2z" />
    </svg>
  );
}

export default InputSection;
