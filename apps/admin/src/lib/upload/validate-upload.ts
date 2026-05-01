const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export interface UploadValidationResult {
  safe: boolean
  error?: string
  sanitizedName?: string
}

/**
 * Validate an uploaded file for safe storage.
 * Checks MIME type, file size, extension, and sanitizes filename.
 */
export function validateUpload(file: File): UploadValidationResult {
  // 1. MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    return {
      safe: false,
      error: `Invalid file type: ${file.type}. Only JPEG, PNG, and WebP are allowed.`,
    }
  }

  // 2. File size
  if (file.size > MAX_FILE_SIZE) {
    return {
      safe: false,
      error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum is 5MB.`,
    }
  }

  // 3. Extension validation
  const originalName = file.name.toLowerCase()
  const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => originalName.endsWith(ext))
  if (!hasValidExt) {
    return {
      safe: false,
      error: `Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
    }
  }

  // 4. Sanitize filename
  const sanitizedName = sanitizeFilename(originalName)

  return { safe: true, sanitizedName }
}

function sanitizeFilename(name: string): string {
  // Strip path traversal attempts
  const baseName = name.replace(/^.*[\\/]/, '')

  // Split extension
  const lastDot = baseName.lastIndexOf('.')
  const ext = lastDot >= 0 ? baseName.slice(lastDot) : ''
  const base = lastDot >= 0 ? baseName.slice(0, lastDot) : baseName

  // Replace unsafe characters with hyphens
  const safeBase = base
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  // Ensure non-empty base
  const finalBase = safeBase || 'file'

  return `${finalBase}-${Date.now()}${ext}`
}

/**
 * Generate a safe storage path for product images.
 * Validates productId to prevent path traversal.
 */
export function generateStoragePath(
  productId: string,
  sanitizedName: string
): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(productId)) {
    throw new Error('Invalid product ID for storage path')
  }
  return `${productId}/${sanitizedName}`
}
