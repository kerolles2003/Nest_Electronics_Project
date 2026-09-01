import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from '../../../config/env.schema';

/**
 * VENDOR configuration — read by the Cloudinary adapter and by nothing else.
 *
 * Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §5;
 *            docs/architecture/MEDIA-MODEL.md §12.
 *
 * This namespace is the whole reason the credentials are absent from the
 * application-level `media` namespace: a secret only one adapter can reach
 * cannot be leaked by a service that has no way to obtain it.
 *
 * `cloudName` is the odd one out — it is a PUBLIC identifier that appears in
 * every delivery URL, and the storefront needs it to build one. It still lives
 * here rather than in the shared namespace, because the API never renders a URL
 * (ADR-MEDIA-002) and therefore never needs it outside this adapter. The
 * storefront reads its own copy from its own environment; the two are the same
 * public string, not a shared secret.
 *
 * The values are non-null by construction, not by assertion: the env schema
 * makes all three mandatory whenever `MEDIA_PROVIDER=cloudinary`, and this
 * namespace is only ever injected by the adapter that selection chooses. The
 * fallbacks exist so a hypothetical direct instantiation fails loudly at the
 * first call rather than sending unauthenticated requests.
 */
export const cloudinaryConfig = registerAs('cloudinary', () => {
  const e = env();

  return {
    cloudName: e.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: e.CLOUDINARY_API_KEY ?? '',
    apiSecret: e.CLOUDINARY_API_SECRET ?? '',
  } as const;
});

export type CloudinaryConfig = ConfigType<typeof cloudinaryConfig>;
