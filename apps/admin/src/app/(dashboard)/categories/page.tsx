import { requireAdmin } from '@/lib/services';
import { CategoriesManager } from '@/components/categories/CategoriesManager';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { AlertTriangle } from 'lucide-react';

/**
 * Categories, from the API.
 *
 * `includeDeleted=true` on purpose. A deleted category keeps its slug reserved,
 * so it is not gone — it is holding a name — and hiding it would leave an
 * operator unable to work out why a slug they want is refused. It renders
 * greyed with a Restore action.
 *
 * The list arrives FLAT and shallowest-first, each row carrying `parentId`,
 * `path` and `depth`. No tree is built here: indentation is `depth`, and
 * reconstructing a `children` array would be redoing what the server resolved.
 */
export default async function CategoriesPage() {
  await requireAdmin();

  const res = await tryApi(() => api.listAdminCategories({ includeDeleted: true }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Categories</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The tree every product is filed under. Renaming one rewrites the category shown on every
          product beneath it.
        </p>
      </div>

      {res.ok ? (
        <CategoriesManager categories={res.data.data} />
      ) : (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive/70" />
          <h2 className="text-base font-bold text-foreground">Categories could not be loaded</h2>
          <p className="mt-1 text-sm text-muted-foreground">{operatorMessage(res.error)}</p>
        </div>
      )}
    </div>
  );
}
