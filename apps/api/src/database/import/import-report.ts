import type { ImageImportResult } from './image-importer';
/**
 * What one import run did, in a form a non-developer can act on.
 *
 * Authority: PLAN.md Phase 4 item 1 — "per-run count/skip/error report".
 *
 * ## Why `unchanged` is separate from `updated`
 *
 * Because "running the same file twice changes nothing the second time" is a
 * property the operator has to be able to SEE, not one they have to trust. With
 * the two merged, a second run reporting "1,240 updated" is indistinguishable
 * from a tool that rewrites every document on every run — which is the same
 * output an idempotency bug would produce.
 *
 * Separating them makes the second run report `1,240 unchanged, 0 updated`, and
 * makes a regression in that behaviour visible in the ordinary output of an
 * ordinary run rather than only in a test.
 */

export type RowOutcome = 'created' | 'updated' | 'unchanged' | 'skipped' | 'errored';

export interface RowResult {
  /** 1-based, counting the header as row 1 — what a spreadsheet shows. */
  readonly line: number;
  readonly key: string;
  readonly outcome: RowOutcome;
  /** Present for `skipped` and `errored`, and phrased for the person fixing it. */
  readonly reason?: string;
  /**
   * Present only when `--images` was passed AND the profile maps `imagePaths`.
   *
   * Kept OUT of `outcome` deliberately. A row whose product was unchanged but
   * whose three photographs were uploaded is still `unchanged` as far as the
   * catalogue columns go, and folding images into the outcome would make the
   * idempotency signal — "3 unchanged, 0 updated" on a second run — mean two
   * different things at once.
   */
  readonly images?: ImageImportResult;
}

export interface ImportReport {
  readonly profile: string;
  readonly file: string;
  readonly dryRun: boolean;
  readonly rows: readonly RowResult[];
  readonly startedAt: Date;
  readonly finishedAt: Date;
}

export function countByOutcome(report: ImportReport): Record<RowOutcome, number> {
  const counts: Record<RowOutcome, number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errored: 0,
  };

  for (const row of report.rows) counts[row.outcome] += 1;

  return counts;
}

/**
 * The report as an operator reads it.
 *
 * Problems first and in full; successes as counts. That ordering is the whole
 * design: nobody scrolls through 1,200 "created" lines to find the 3 rows that
 * failed, so a report that prints them in file order buries exactly the
 * information it exists to convey.
 */
export function renderReport(report: ImportReport): string {
  const counts = countByOutcome(report);
  const seconds = ((report.finishedAt.getTime() - report.startedAt.getTime()) / 1000).toFixed(1);

  const lines: string[] = [
    '',
    '='.repeat(72),
    `CATALOGUE IMPORT — ${report.dryRun ? 'DRY RUN, nothing was written' : 'COMPLETE'}`,
    '='.repeat(72),
    `file     ${report.file}`,
    `profile  ${report.profile}`,
    `took     ${seconds}s`,
    '',
    `  created    ${String(counts.created).padStart(6)}`,
    `  updated    ${String(counts.updated).padStart(6)}`,
    `  unchanged  ${String(counts.unchanged).padStart(6)}   (already correct — nothing written)`,
    `  skipped    ${String(counts.skipped).padStart(6)}`,
    `  errored    ${String(counts.errored).padStart(6)}`,
    `  ${'-'.repeat(20)}`,
    `  rows read  ${String(report.rows.length).padStart(6)}`,
    '',
  ];

  /*
   * The image section only appears when images were actually being imported.
   * A block reading "0 uploaded" on every ordinary run would train the reader
   * to skip past it, which is how the run that DID fail to upload gets missed.
   */
  const withImages = report.rows.filter((row) => row.images !== undefined);

  if (withImages.length > 0) {
    const uploaded = withImages.reduce((total, row) => total + (row.images?.uploaded ?? 0), 0);
    const skipped = withImages.reduce((total, row) => total + (row.images?.skipped ?? 0), 0);
    const failed = withImages.flatMap((row) =>
      (row.images?.failures ?? []).map((failure) => `  row ${String(row.line)}  ${failure}`),
    );

    lines.push(
      'IMAGES',
      `  uploaded   ${String(uploaded).padStart(6)}`,
      `  skipped    ${String(skipped).padStart(6)}   (the product already has images)`,
      `  failed     ${String(failed.length).padStart(6)}`,
      '',
    );

    if (failed.length > 0) {
      lines.push(
        'The products themselves imported; only these files did not.',
        "Fix the files, clear that product's images in admin, and run again.",
        '',
        ...failed,
        '',
      );
    }
  }

  const problems = report.rows.filter(
    (row) => row.outcome === 'skipped' || row.outcome === 'errored',
  );

  if (problems.length === 0) {
    lines.push('No rows were skipped or errored.', '');
    return lines.join('\n');
  }

  lines.push(
    `${String(problems.length)} row(s) need attention. Row numbers match the spreadsheet,`,
    'counting the header as row 1.',
    '',
  );

  for (const row of problems) {
    lines.push(
      `  row ${String(row.line).padStart(5)}  ${row.outcome.toUpperCase().padEnd(7)}  ` +
        `${row.key || '(no key)'}`,
      `             ${row.reason ?? 'no reason recorded'}`,
    );
  }

  lines.push(
    '',
    'Nothing above was imported. Fix those rows in the spreadsheet and run the',
    'import again — rows that already imported correctly will report as',
    '"unchanged" and will not be written a second time.',
    '',
  );

  return lines.join('\n');
}
