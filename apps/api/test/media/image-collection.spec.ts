import { describe, expect, it } from '@jest/globals';
import {
  attach,
  detach,
  ImageCollectionError,
  normalise,
  reorder,
  setPrimary,
  type OrderedImage,
} from '../../src/modules/media/application/image-collection';

/**
 * The ordering and primary-image invariant — MEDIA-MODEL.md §9.2.
 *
 * > **Invariant:** a non-empty `images[]` has exactly one `isPrimary`.
 *
 * Asserted as a property of the RESULT of every operation rather than checked
 * once in a happy path, because the two legacy defects these functions replace
 * were both about the states in between: a reorder that was N updates in a loop,
 * and a set-primary that was unset-all followed by set-one, non-atomically. Both
 * produced a correct final state most of the time.
 */

const img = (publicId: string, sortOrder: number, isPrimary = false): OrderedImage => ({
  publicId,
  sortOrder,
  isPrimary,
});

/** The invariant, stated once and asserted after every operation below. */
function assertInvariant(images: readonly OrderedImage[]): void {
  expect({
    primaries: images.filter((image) => image.isPrimary).length,
    sortOrders: images.map((image) => image.sortOrder),
  }).toEqual({
    primaries: images.length === 0 ? 0 : 1,
    sortOrders: images.map((_, index) => index),
  });
}

describe('normalise', () => {
  it('leaves an empty collection empty, with no primary to find', () => {
    const result = normalise([]);

    expect(result).toEqual([]);
    assertInvariant(result);
  });

  it('promotes the first image when NONE claims to be primary', () => {
    // The repair-on-read case. A document written before this code existed can
    // hold a collection with no primary at all, and rejecting it would make the
    // data unreadable rather than making it correct.
    const result = normalise([img('a', 0), img('b', 1), img('c', 2)]);

    expect(result.map((i) => [i.publicId, i.isPrimary])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ]);
    assertInvariant(result);
  });

  it('keeps the FIRST claimant when several claim to be primary', () => {
    const result = normalise([img('a', 0), img('b', 1, true), img('c', 2, true)]);

    expect(result.find((i) => i.isPrimary)?.publicId).toBe('b');
    assertInvariant(result);
  });

  it('closes gaps in sortOrder without reordering anything', () => {
    const result = normalise([img('a', 7), img('b', 2, true), img('c', 99)]);

    expect(result.map((i) => [i.publicId, i.sortOrder])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
    assertInvariant(result);
  });
});

describe('attach', () => {
  it('appends and makes the first image primary', () => {
    const result = attach([], img('a', 0), 8);

    expect(result.map((i) => [i.publicId, i.isPrimary])).toEqual([['a', true]]);
    assertInvariant(result);
  });

  it('does NOT steal the primary flag from an existing image', () => {
    const existing = normalise([img('a', 0), img('b', 1)]);
    const result = attach(existing, img('c', 0), 8);

    expect(result.find((i) => i.isPrimary)?.publicId).toBe('a');
    assertInvariant(result);
  });

  it('refuses to exceed the count limit, server-side', () => {
    // §5 item 9: legacy enforced this only in the React component, which is to
    // say it did not enforce it.
    const full = normalise(Array.from({ length: 8 }, (_, i) => img(`a${String(i)}`, i)));

    expect(() => attach(full, img('extra', 0), 8)).toThrow(ImageCollectionError);
    expect(() => attach(full, img('extra', 0), 8)).toThrow('at most 8 images');
  });

  it('refuses to attach the same asset twice', () => {
    // Not a tidiness rule: two entries for one publicId means the reference
    // count and the number of visible copies disagree, and a later detach
    // removes both while releasing one reference.
    const existing = attach([], img('a', 0), 8);

    expect(() => attach(existing, img('a', 0), 8)).toThrow('already attached');
  });
});

describe('detach', () => {
  it('promotes the next image by order when the PRIMARY is removed', () => {
    const images = setPrimary(normalise([img('a', 0), img('b', 1), img('c', 2)]), 'a');
    const result = detach(images, 'a');

    expect(result.find((i) => i.isPrimary)?.publicId).toBe('b');
    assertInvariant(result);
  });

  it('leaves the primary alone when a NON-primary is removed', () => {
    const images = setPrimary(normalise([img('a', 0), img('b', 1), img('c', 2)]), 'b');
    const result = detach(images, 'c');

    expect(result.find((i) => i.isPrimary)?.publicId).toBe('b');
    assertInvariant(result);
  });

  it('produces a valid EMPTY collection when the last image goes', () => {
    const result = detach(attach([], img('a', 0), 8), 'a');

    expect(result).toEqual([]);
    assertInvariant(result);
  });

  it('refuses an id that is not attached rather than succeeding silently', () => {
    expect(() => detach(normalise([img('a', 0)]), 'ghost')).toThrow('is not attached');
  });
});

describe('reorder', () => {
  it('rewrites the order in one replacement', () => {
    const images = normalise([img('a', 0), img('b', 1), img('c', 2)]);
    const result = reorder(images, ['c', 'a', 'b']);

    expect(result.map((i) => i.publicId)).toEqual(['c', 'a', 'b']);
    assertInvariant(result);
  });

  it('does NOT change which image is primary', () => {
    /*
     * The flag travels with its image; only `setPrimary` moves it.
     *
     * Recorded because the first draft of this suite asserted the opposite, on
     * the theory that dragging an image to the front is how an operator
     * promotes it. The test failed, and the TEST was wrong: §9.2 lists reorder
     * and set-primary as two operations, and `setPrimary` already argues that
     * "primary" and "first" are different questions. If reordering also
     * promoted, an operator tidying a gallery would silently change the image
     * shown on every product card — exactly the unrequested side effect the
     * two-operation split exists to prevent.
     */
    const images = setPrimary(normalise([img('a', 0), img('b', 1)]), 'a');
    const result = reorder(images, ['b', 'a']);

    expect(result.map((i) => [i.publicId, i.isPrimary])).toEqual([
      ['b', false],
      ['a', true],
    ]);
    assertInvariant(result);
  });

  it.each([
    ['a partial list', ['a', 'b']],
    ['a list with a duplicate', ['a', 'a', 'b']],
    ['a list naming an unattached id', ['a', 'b', 'ghost']],
  ])('refuses %s rather than interpreting it', (_label, order) => {
    const images = normalise([img('a', 0), img('b', 1), img('c', 2)]);

    expect(() => reorder(images, order)).toThrow(ImageCollectionError);
  });
});

describe('setPrimary', () => {
  it('moves the flag without moving the images', () => {
    // "Primary" and "first" are different questions. Conflating them would
    // reorder an operator's gallery every time they picked a thumbnail.
    const images = normalise([img('a', 0), img('b', 1), img('c', 2)]);
    const result = setPrimary(images, 'c');

    expect(result.map((i) => [i.publicId, i.isPrimary])).toEqual([
      ['a', false],
      ['b', false],
      ['c', true],
    ]);
    assertInvariant(result);
  });

  it('is idempotent', () => {
    const images = normalise([img('a', 0), img('b', 1)]);

    expect(setPrimary(setPrimary(images, 'b'), 'b')).toEqual(setPrimary(images, 'b'));
  });

  it('never leaves the collection without a primary, even mid-sequence', () => {
    // The legacy set-primary was unset-all THEN set-one, so a read between the
    // two statements saw a product with no primary image. There is no "between"
    // here — the function returns one complete array — and this asserts that
    // every step of a chain of changes is individually valid.
    let images = normalise([img('a', 0), img('b', 1), img('c', 2)]);

    for (const id of ['b', 'c', 'a', 'c']) {
      images = setPrimary(images, id);
      assertInvariant(images);
      expect(images.find((i) => i.isPrimary)?.publicId).toBe(id);
    }
  });

  it('refuses an id that is not attached', () => {
    expect(() => setPrimary(normalise([img('a', 0)]), 'ghost')).toThrow('is not attached');
  });
});
