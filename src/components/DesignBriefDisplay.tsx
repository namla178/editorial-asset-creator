'use client';

import React, { useState } from 'react';
import { DesignBrief } from '@/types';

interface DesignBriefDisplayProps {
  brief: DesignBrief | undefined;
  isVisible: boolean;
}

/**
 * Collapsible component for displaying the design brief
 */
export function DesignBriefDisplay({ brief, isVisible }: DesignBriefDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isVisible || !brief) {
    return null;
  }

  return (
    <section className="w-full max-w-3xl mx-auto p-6">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 bg-dark-card border border-dark-border rounded-xl hover:border-accent-purple transition-colors"
      >
        <div className="flex items-center gap-3">
          <DocumentIcon />
          <span className="text-white font-semibold">Design Brief</span>
        </div>
        <ChevronIcon isExpanded={isExpanded} />
      </button>

      {isExpanded && (
        <div className="mt-2 p-6 bg-dark-card border border-dark-border rounded-xl space-y-6">
          {/* Visual Style */}
          <BriefSection title="Visual Style" icon={<EyeIcon />}>
            <p className="text-gray-300">{brief.visualStyle}</p>
          </BriefSection>

          {/* Messaging */}
          <BriefSection title="Messaging" icon={<ChatIcon />}>
            <p className="text-gray-300">{brief.messaging}</p>
          </BriefSection>

          {/* Target Audience */}
          <BriefSection title="Target Audience" icon={<UsersIcon />}>
            <p className="text-gray-300">{brief.targetAudience}</p>
          </BriefSection>

          {/* Mood */}
          <BriefSection title="Mood & Atmosphere" icon={<SparklesIcon />}>
            <p className="text-gray-300">{brief.mood}</p>
          </BriefSection>

          {/* Color Palette */}
          <BriefSection title="Color Palette" icon={<PaletteIcon />}>
            <div className="flex gap-2 flex-wrap">
              {brief.colorPalette.map((color, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 px-3 py-2 bg-dark-bg rounded-lg"
                >
                  <div
                    className="w-6 h-6 rounded-full border border-dark-border"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-gray-400 text-sm font-mono">{color}</span>
                </div>
              ))}
            </div>
          </BriefSection>

          {/* Key Features */}
          <BriefSection title="Key Features" icon={<ListIcon />}>
            <ul className="list-disc list-inside space-y-1">
              {brief.keyFeatures.map((feature, index) => (
                <li key={index} className="text-gray-300">{feature}</li>
              ))}
            </ul>
          </BriefSection>

          {/* Call to Action */}
          <BriefSection title="Call to Action" icon={<ArrowIcon />}>
            <span className="inline-block px-4 py-2 bg-accent-purple text-white rounded-lg font-semibold">
              {brief.callToAction}
            </span>
          </BriefSection>

          {/* Image Prompt */}
          <BriefSection title="Image Generation Prompt" icon={<ImageIcon />}>
            <div className="p-4 bg-dark-bg rounded-lg">
              <p className="text-gray-400 text-sm font-mono whitespace-pre-wrap">
                {brief.imagePrompt}
              </p>
            </div>
          </BriefSection>
        </div>
      )}
    </section>
  );
}

interface BriefSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Individual section within the design brief
 */
function BriefSection({ title, icon, children }: BriefSectionProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-accent-purple">{icon}</span>
        <h3 className="text-white font-semibold">{title}</h3>
      </div>
      <div className="ml-6">{children}</div>
    </div>
  );
}

// Icon components
function ChevronIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg className="w-5 h-5 text-accent-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744l.99 3.465 3.488.987a1 1 0 010 1.928l-3.488.987-.99 3.465a1 1 0 01-1.934 0l-.99-3.465-3.488-.987a1 1 0 010-1.928l3.488-.987.99-3.465A1 1 0 0112 2z" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

export default DesignBriefDisplay;
