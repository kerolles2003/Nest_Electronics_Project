/**
 * The ordering and primary-image invariant, as pure functions.
 *
 * Authority: docs/architecture/MEDIA-MODEL.md §9.2; CATALOG-MODEL.md §8.
 *
 * > **Invariant:** a non-empty `images[]` has exactly one `isPrimary`.
 *
 * ## Why this is a function and not an endpoint
 *
 * Phase 4 ships the media pipeline; product CRUD is Phase 7. The invariant
 * still belongs here and now, because it is the part that is easy to get wrong
 * and expensive to discover later — legacy got it wrong twice, and both were
 * concurrency defects rather than logic ones:
 *
 *   reorder      one UPDATE per image, in a loop. Interleave two operators and
 *                the array ends up in an order neither of them asked for.
 *   set-primary  unset-all, then set-one, as two statements. A read between
 *                them sees a product with NO primary image.
 *
 * Every function below returns a COMPLETE replacement array, which is what
 * makes the persisting write a single atomic `$set` rather than a sequence.
 * The concurrency property is a consequence of the shape, not of a lock.
 *
 * ## Why the result is always normalised
 *
 * Each function ends in `normalise`, so no caller can produce a collection with
 * two primaries, no primary, or gaps in `sortOrder` — including callers that
 * pass in an already-broken array read from a document written before this code
 * existed. A repair on read is worth more than a validator that rejects: the
 * data is already there.
 */

/** The subset of a stored image these rules operate on. */
export interface OrderedImage {
  readonly publicId: string;
  readonly sortOrder: number;
  readonly isPrimary: boolean;
}

/** Raised when the operation itself is impossible; the caller maps it to a 4xx. */
export class ImageCollectionError extends Error {}

/**
 * Exactly one primary, `sortOrder` dense from zero, order preserved.
 *
 * The primary is whichever element already claims it — the FIRST such, if a
 * broken document claims several — and otherwise the first element. That rule
 * is chosen because it is total: it produces a valid collection from any input,
 * including the empty one, without ever needing to ask the caller.
 */
export function normalise<T extends OrderedImage>(images: readonly T[]): T[] {
  const primaryIndex = Math.max(
    0,
    images.findIndex((image) => image.isPrimary),
  );

  return images.map((image, index) => ({
    ...image,
    sortOrder: index,
    isPrimary: index === primaryIndex,
  }));
}

/**
 * Appends an image, refusing to exceed the count limit.
 *
 * The limit is enforced HERE — server-side — because legacy enforced it only in
 * the React component, which is to say it did not enforce it (§5 item 9).
 */
export function attach<T extends OrderedImage>(
  images: readonly T[],
  image: T,
  maxImages: number,
): T[] {
  if (images.some((existing) => existing.publicId === image.publicId)) {
    throw new ImageCollectionError(`${image.publicId} is already attached`);
  }

  if (images.length >= maxImages) {
    throw new ImageCollectionError(
      `a product may have at most ${String(maxImages)} images; this one already has ${String(images.length)}`,
    );
  }

  return normalise([...images, image]);
}

/**
 * Removes one image and promotes the next by order if it was the primary.
 *
 * Removing the primary is the interesting case and the one `normalise` already
 * answers: with the element gone, the first survivor becomes primary. Stating
 * it in the docstring rather than in a branch is deliberate — a branch here
 * would be a second implementation of the same rule, and the two would
 * eventually disagree.
 */
export function detach<T extends OrderedImage>(images: readonly T[], publicId: string): T[] {
  const remaining = images.filter((image) => image.publicId !== publicId);

  if (remaining.length === images.length) {
    throw new ImageCollectionError(`${publicId} is not attached`);
  }

  return normalise(remaining);
}

/**
 * Rewrites the order from a complete list of ids.
 *
 * COMPLETE is the operative word: a partial list is refused rather than
 * interpreted, because every reasonable interpretation ("move these to the
 * front", "leave the rest alone") is a different one, and picking one silently
 * means an operator's reorder does something they did not ask for.
 *
 * **The primary flag travels with its image and reordering never moves it.**
 * That is the same rule `setPrimary` states from the other side: "primary" and
 * "first" are different questions, and a catalogue photograph can be the one to
 * show in a grid without being the one to show first in a gallery. §9.2 lists
 * reorder and set-primary as two operations, and they stay two — dragging an
 * image to the front must not silently change which one appears on every
 * product card.
 */
export function reorder<T extends OrderedImage>(
  images: readonly T[],
  publicIds: readonly string[],
): T[] {
  const byId = new Map(images.map((image) => [image.publicId, image]));

  if (publicIds.length !== images.length || new Set(publicIds).size !== publicIds.length) {
    throw new ImageCollectionError(
      `the order must list each of the ${String(images.length)} images exactly once`,
    );
  }

  return normalise(
    publicIds.map((publicId) => {
      const image = byId.get(publicId);
      if (image === undefined) throw new ImageCollectionError(`${publicId} is not attached`);
      return image;
    }),
  );
}

/**
 * Makes one image the primary, in one replacement rather than two writes.
 *
 * Order is NOT changed. "Primary" and "first" are different questions — a
 * catalogue photograph can be the one to show in a grid without being the one
 * to show first in a gallery — and conflating them would silently reorder an
 * operator's gallery every time they picked a thumbnail.
 */
export function setPrimary<T extends OrderedImage>(images: readonly T[], publicId: string): T[] {
  if (!images.some((image) => image.publicId === publicId)) {
    throw new ImageCollectionError(`${publicId} is not attached`);
  }

  return images.map((image, index) => ({
    ...image,
    sortOrder: index,
    isPrimary: image.publicId === publicId,
  }));
}
