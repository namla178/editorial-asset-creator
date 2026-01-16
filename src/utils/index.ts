/**
 * Validates environment variables on startup
 */
export function validateEnvironment(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    errors.push('OPENAI_API_KEY is not set');
  }

  // Check Google Cloud configuration (optional warning)
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    console.warn('GOOGLE_CLOUD_PROJECT is not set - image generation may fail');
  }

  if (!process.env.GOOGLE_CLOUD_REGION) {
    console.warn('GOOGLE_CLOUD_REGION is not set - defaulting to us-central1');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Formats a date to a readable string
 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Sleep utility function
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Truncates a string to a maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Generates a random ID (for client-side use)
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, wait);
  };
}
