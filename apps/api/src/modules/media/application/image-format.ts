/**
 * What the BYTES say they are, as opposed to what the upload claimed.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §5 item 3 — "`file-type` inspects
 * actual bytes. A file declaring `image/png` whose content is not PNG is
 * rejected. Legacy trusted the declared type."
 *
 * ## Why this is hand-written rather than `file-type`
 *
 * `file-type` recognises ~150 formats. This allow-list has three, and their
 * signatures are fixed, short, and specified in the format standards rather
 * than reverse-engineered. Against that, the package is ESM-only from v17
 * onwards, and this project compiles to CommonJS with ts-jest — so adopting it
 * means either pinning a five-year-old version or reshaping the build for one
 * function.
 *
 * The trade is worth naming precisely, because "we wrote our own instead of
 * using the library" is usually the wrong answer: the library's value is
 * BREADTH, and breadth is the one thing this use has no need for. Every format
 * outside the allow-list must be rejected, so recognising more of them changes
 * nothing. Adding a fourth format costs one entry below and one test.
 *
 * ## Why sniffing is not enough on its own
 *
 * A signature check proves the first few bytes are consistent with a format. It
 * does not prove the file is a valid image, and it is not a security boundary
 * by itself — a JPEG with a valid header and a malicious payload after it still
 * has a valid header. The boundary is the re-encode in `image-processing.ts`:
 * every accepted upload is decoded and written out again, so whatever else the
 * original contained does not survive. Sniffing exists to reject the obvious
 * lie cheaply, before spending CPU on a decode.
 */

/** A format this system will accept, and how to recognise it in the bytes. */
interface ImageSignature {
  /** The canonical short name persisted as `format`. */
  readonly format: 'jpeg' | 'png' | 'webp';
  /** The declared MIME type that must accompany it. */
  readonly mimeType: string;
  /** Byte-for-byte prefix, or `null` for a wildcard byte. */
  readonly magic: readonly (number | null)[];
  /** A second run of bytes to check, at a fixed offset. */
  readonly at?: { readonly offset: number; readonly bytes: readonly number[] };
}

const ASCII = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

const SIGNATURES: readonly ImageSignature[] = [
  {
    // SOI marker, then the start of any APPn/JFIF/Exif segment.
    format: 'jpeg',
    mimeType: 'image/jpeg',
    magic: [0xff, 0xd8, 0xff],
  },
  {
    // The PNG signature is designed to detect transmission damage, which is why
    // it carries a CRLF/LF pair and a DOS end-of-file byte.
    format: 'png',
    mimeType: 'image/png',
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    // A RIFF container whose four-byte form type is WEBP. Bytes 4..7 are the
    // chunk length and vary, hence the wildcards.
    format: 'webp',
    mimeType: 'image/webp',
    magic: [...ASCII('RIFF'), null, null, null, null],
    at: { offset: 8, bytes: ASCII('WEBP') },
  },
];

function matches(buffer: Buffer, signature: ImageSignature): boolean {
  if (buffer.length < signature.magic.length) return false;

  for (const [index, expected] of signature.magic.entries()) {
    if (expected !== null && buffer[index] !== expected) return false;
  }

  const tail = signature.at;
  if (tail !== undefined) {
    if (buffer.length < tail.offset + tail.bytes.length) return false;

    for (const [index, expected] of tail.bytes.entries()) {
      if (buffer[tail.offset + index] !== expected) return false;
    }
  }

  return true;
}

/**
 * The format the bytes actually are, or `null` for anything not on the
 * allow-list.
 *
 * `null` covers both "a format we do not accept" and "not an image at all", and
 * they are deliberately not distinguished: telling an uploader that their file
 * was recognised as a TIFF is information about the sniffer, not about what
 * they should do next.
 */
export function sniffImageFormat(buffer: Buffer): ImageSignature['format'] | null {
  return SIGNATURES.find((signature) => matches(buffer, signature))?.format ?? null;
}

/** The MIME type an upload must declare for a given sniffed format. */
export function mimeTypeForFormat(format: ImageSignature['format']): string {
  const signature = SIGNATURES.find((entry) => entry.format === format);

  /* istanbul ignore next -- unreachable: `format` comes from SIGNATURES. */
  if (signature === undefined) throw new Error(`unknown image format ${format}`);

  return signature.mimeType;
}
