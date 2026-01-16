/**
 * Logging utilities with base64 truncation
 */

/**
 * Truncates base64 strings in objects to prevent large logs
 */
export function truncateBase64(obj: any, maxLength: number = 100): any {
  if (typeof obj === 'string') {
    // Check if it looks like base64 (long alphanumeric string)
    if (obj.length > 200 && /^[A-Za-z0-9+/=]+$/.test(obj.slice(0, 100))) {
      return `[BASE64_${Math.floor(obj.length / 1024)}KB_TRUNCATED]`;
    }
    // Truncate very long strings
    if (obj.length > 500) {
      return obj.slice(0, maxLength) + `... [${obj.length} chars total]`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => truncateBase64(item, maxLength));
  }

  if (obj !== null && typeof obj === 'object') {
    const truncated: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Known base64 fields
      if (key.toLowerCase().includes('base64') || 
          key.toLowerCase().includes('image') || 
          key.toLowerCase().includes('bytes')) {
        if (typeof value === 'string' && value.length > 200) {
          truncated[key] = `[BASE64_${Math.floor(value.length / 1024)}KB]`;
        } else {
          truncated[key] = truncateBase64(value, maxLength);
        }
      } else {
        truncated[key] = truncateBase64(value, maxLength);
      }
    }
    return truncated;
  }

  return obj;
}

/**
 * Logs request with truncated base64
 */
export function logRequest(service: string, method: string, data: any) {
  console.log(`\n========== ${service} REQUEST ==========`);
  console.log(`Method: ${method}`);
  console.log('Data:', JSON.stringify(truncateBase64(data), null, 2));
  console.log('='.repeat(50));
}

/**
 * Logs response with truncated base64
 */
export function logResponse(service: string, method: string, data: any) {
  console.log(`\n========== ${service} RESPONSE ==========`);
  console.log(`Method: ${method}`);
  console.log('Data:', JSON.stringify(truncateBase64(data), null, 2));
  console.log('='.repeat(50));
}

/**
 * Logs error with truncated data
 */
export function logError(service: string, method: string, error: any, context?: any) {
  console.error(`\n========== ${service} ERROR ==========`);
  console.error(`Method: ${method}`);
  console.error('Error:', error.message || error);
  if (context) {
    console.error('Context:', JSON.stringify(truncateBase64(context), null, 2));
  }
  console.error('='.repeat(50));
}
