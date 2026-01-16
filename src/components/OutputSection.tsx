'use client';

import React from 'react';
import { GeneratedAsset } from '@/types';

interface OutputSectionProps {
  assets: GeneratedAsset[];
  onDownload: (assetId: string) => void;
  onDownloadAll: () => void;
  onRegenerate: () => void;
  isVisible: boolean;
}

/**
 * Output section component displaying generated assets
 */
export function OutputSection({
  assets,
  onDownload,
  onDownloadAll,
  onRegenerate,
  isVisible,
}: OutputSectionProps) {
  if (!isVisible || assets.length === 0) {
    return null;
  }

  return (
    <section className="w-full max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">
          Generated Assets
        </h2>
        <div className="flex gap-3">
          <button
            onClick={onRegenerate}
            className="px-4 py-2 bg-dark-card border border-dark-border text-white rounded-lg hover:bg-dark-border transition-colors flex items-center gap-2"
          >
            <RefreshIcon />
            Regenerate
          </button>
          {assets.length > 1 && (
            <button
              onClick={onDownloadAll}
              className="px-4 py-2 bg-accent-purple text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              <DownloadIcon />
              Download All
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {assets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            onDownload={() => onDownload(asset.id)}
          />
        ))}
      </div>
    </section>
  );
}

interface AssetCardProps {
  asset: GeneratedAsset;
  onDownload: () => void;
}

/**
 * Individual asset card component
 */
function AssetCard({ asset, onDownload }: AssetCardProps) {
  const isVideo = asset.type === 'video';

  return (
    <div className="group relative bg-dark-card border border-dark-border rounded-xl overflow-hidden transition-all duration-300 hover:border-accent-purple hover:shadow-lg hover:shadow-accent-purple/20">
      {/* Preview */}
      <div className="aspect-square relative overflow-hidden bg-dark-bg">
        {isVideo ? (
          <video
            src={asset.url}
            className="w-full h-full object-cover"
            controls
            poster={asset.thumbnail}
          />
        ) : (
          <img
            src={asset.url}
            alt={asset.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}

        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <button
            onClick={onDownload}
            className="px-6 py-3 bg-white text-dark-bg font-semibold rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-2"
          >
            <DownloadIcon />
            Download
          </button>
        </div>

        {/* Type badge */}
        <div className="absolute top-3 right-3">
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
            isVideo 
              ? 'bg-accent-blue text-white' 
              : 'bg-accent-purple text-white'
          }`}>
            {isVideo ? 'Video' : 'Image'}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="text-white font-semibold truncate mb-1">
          {asset.title}
        </h3>
        <p className="text-gray-400 text-sm line-clamp-2">
          {asset.description}
        </p>
        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <span>
            {asset.metadata.width}x{asset.metadata.height}
          </span>
          <span>
            {formatFileSize(asset.metadata.size)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Formats file size to human readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Download icon component
 */
function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
  );
}

/**
 * Refresh icon component
 */
function RefreshIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

export default OutputSection;
