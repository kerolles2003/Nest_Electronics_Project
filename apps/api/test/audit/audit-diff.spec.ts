import { describe, expect, it } from '@jest/globals';
import { REDACTED, diffFields } from '../../src/modules/audit/domain/audit-diff';

/**
 * The field-level diff that decides what an audit record contains.
 *
 * Authority: docs/architecture/AUDIT-MODEL.md §4 — "only the fields that
 * actually changed — not whole documents", and "never stored in `changes`:
 * `passwordHash`, tokens, `costPrice` in a customer-visible context, or full
 * PII".
 *
 * Pure, so every property is decidable from the input and checkable instantly.
 * That matters more here than usual: this function decides what a two-year
 * retention store holds, and the expensive mistakes are both silent — recording
 * a secret, or recording nothing.
 */

describe('what an audit record contains', () => {
  it('records only the fields that changed', () => {
    const changes = diffFields(
      { name: 'ESP32', price: 32500, sku: 'ESP32-DEVKIT' },
      { name: 'ESP32', price: 29900, sku: 'ESP32-DEVKIT' },
    );

    // Not the whole document. An audit row carrying every field of every entity
    // grows without bound and makes the log unreadable by eye.
    expect(changes).toEqual({ before: { price: 32500 }, after: { price: 29900 } });
  });

  it('is null when nothing changed, so no record is written', () => {
    // An audit row saying "somebody saved this and altered nothing" is noise in
    // a log whose entire value is signal, kept for two years.
    expect(diffFields({ price: 32500 }, { price: 32500 })).toBeNull();
  });

  it('reaches into nested objects and names the full path', () => {
    const changes = diffFields(
      { pricing: { basePrice: 32500, salePrice: null } },
      { pricing: { basePrice: 32500, salePrice: 28000 } },
    );

    expect(changes).toEqual({
      before: { 'pricing.salePrice': null },
      after: { 'pricing.salePrice': 28000 },
    });
  });

  it('sees an added field and a removed one', () => {
    const changes = diffFields({ note: 'old' }, { reason: 'damaged' });

    expect(changes?.before).toEqual({ note: 'old', reason: undefined });
    expect(changes?.after).toEqual({ note: undefined, reason: 'damaged' });
  });

  it('compares dates by instant, not by identity', () => {
    // Two Date objects for the same moment are not `===`. Reporting an
    // unchanged timestamp as a change would fill the log with noise on every
    // save, which is how a signal store becomes ignored.
    const when = '2026-09-03T10:00:00.000Z';

    expect(diffFields({ at: new Date(when) }, { at: new Date(when) })).toBeNull();
    expect(diffFields({ at: new Date(when) }, { at: new Date('2026-09-04T10:00:00.000Z') })).not.toBeNull();
  });

  it('compares arrays structurally rather than per index', () => {
    expect(diffFields({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toBeNull();
    expect(diffFields({ tags: ['a'] }, { tags: ['a', 'b'] })).not.toBeNull();
  });
});

describe('what an audit record must never contain', () => {
  it('replaces a password hash with a marker rather than storing it', () => {
    const changes = diffFields(
      { passwordHash: '$2b$12$oldhashvalue' },
      { passwordHash: '$2b$12$newhashvalue' },
    );

    expect(changes).toEqual({
      before: { passwordHash: REDACTED },
      after: { passwordHash: REDACTED },
    });
  });

  it('proves it can fail: the hash is genuinely absent from the record', () => {
    /*
     * The half that makes the guarantee checkable. Without this, `REDACTED`
     * could be appended alongside the real value and every other assertion here
     * would still pass.
     */
    const changes = diffFields(
      { passwordHash: '$2b$12$oldhashvalue' },
      { passwordHash: '$2b$12$newhashvalue' },
    );

    expect(JSON.stringify(changes)).not.toContain('oldhashvalue');
    expect(JSON.stringify(changes)).not.toContain('newhashvalue');
  });

  it('still records THAT the field changed', () => {
    // "The password hash changed" is exactly what an investigator needs.
    // Omitting the field would say "nothing changed", which is a lie.
    const changes = diffFields({ passwordHash: 'a' }, { passwordHash: 'b' });

    expect(Object.keys(changes?.after ?? {})).toContain('passwordHash');
  });

  it('redacts tokens wherever they are nested', () => {
    const changes = diffFields(
      { session: { refreshToken: 'rt-old' } },
      { session: { refreshToken: 'rt-new' } },
    );

    expect(changes?.after).toEqual({ 'session.refreshToken': REDACTED });
    expect(JSON.stringify(changes)).not.toContain('rt-old');
  });

  it('does NOT redact a field that merely contains a secret-ish word', () => {
    /*
     * The other half of the redaction rule. A substring match would swallow
     * `tokenCount` and `resetTokenSentAt` — facts an investigator wants — while
     * protecting nothing extra, because the real secrets are already matched by
     * name.
     */
    const changes = diffFields({ tokenCount: 1 }, { tokenCount: 4 });

    expect(changes).toEqual({ before: { tokenCount: 1 }, after: { tokenCount: 4 } });
  });

  it('does NOT redact costPrice, and that is deliberate', () => {
    /*
     * §4 says "`costPrice` in a customer-visible context". `auditLogs` is not
     * one — §8 restricts it to ADMIN. Redacting it would hide the before and
     * after of a margin change from the only people entitled to see it, which
     * is the opposite of what auditing a money-affecting change is for.
     */
    const changes = diffFields(
      { pricing: { costPrice: 10000 } },
      { pricing: { costPrice: 12000 } },
    );

    expect(changes?.after).toEqual({ 'pricing.costPrice': 12000 });
  });
});
