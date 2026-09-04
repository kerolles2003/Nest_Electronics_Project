'use client';

import { Plus, Trash2, GripVertical } from 'lucide-react';

/**
 * The spec sheet, as flat rows.
 *
 * ## Why this is not the attribute picker it replaces
 *
 * `AttributeEditor` read a Supabase three-table EAV system — `attributes`,
 * `attribute_values` and a join — through `/api/attributes`. Two facts about
 * it: the API has no equivalent, and the legacy tables had **zero
 * assignments**, so the picker offered a vocabulary nothing had ever used.
 *
 * The API's model is a flat `specs[]` on the product: `key`, `label`, `value`,
 * `unit`, `filterable`. There is deliberately no canonical key dictionary —
 * `CatalogModule` records why: *"the canonical key dictionary is owner data
 * nobody has supplied; deriving one from seeded products would be inventing a
 * taxonomy and calling it frozen."*
 *
 * So this is free-form rows, which is honest about the state of the domain. A
 * dictionary can be added later without changing what is stored.
 *
 * ## `key` and `label` are different things, and the difference matters
 *
 * `key` is the machine name a facet groups on — `operating-voltage`. `label` is
 * what a customer reads — "Operating voltage". Two products spelling the label
 * differently still group together if the key matches, which is the entire
 * reason a key exists. The form fills the label from the key when it is left
 * blank rather than requiring both.
 *
 * ## `value` is a string, on purpose
 *
 * Component specs are heterogeneous: "3.3", "Wi-Fi + Bluetooth", "-40 to 85".
 * Numeric range filtering is not in the model, and forcing a number here would
 * make half the real specs unrepresentable.
 */

export interface SpecRow {
  key: string;
  label: string;
  value: string;
  unit: string;
  filterable: boolean;
}

export function emptySpec(): SpecRow {
  return { key: '', label: '', value: '', unit: '', filterable: false };
}

/** `Operating Voltage` → `operating-voltage`. Suggested, never forced. */
function toKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function ProductSpecsEditor({
  specs,
  onChange,
}: {
  specs: SpecRow[];
  onChange: (specs: SpecRow[]) => void;
}) {
  const update = (index: number, patch: Partial<SpecRow>) => {
    onChange(specs.map((spec, position) => (position === index ? { ...spec, ...patch } : spec)));
  };

  const remove = (index: number) => {
    onChange(specs.filter((_, position) => position !== index));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= specs.length) return;

    const next = [...specs];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as SpecRow);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {specs.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          No specifications yet. These become the product&apos;s spec table, and the ones marked
          filterable become search facets.
        </p>
      )}

      {specs.map((spec, index) => (
        <div
          key={index}
          className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-background p-3 md:grid-cols-12"
        >
          <div className="flex items-center gap-1 md:col-span-1">
            {/*
              Buttons rather than drag: position IS the display order, and a
              two-button move is operable by keyboard and on a phone. Drag was
              neither.
            */}
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Move up"
                className="px-1 text-[10px] leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === specs.length - 1}
                aria-label="Move down"
                className="px-1 text-[10px] leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                ▼
              </button>
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Label
            </label>
            <input
              value={spec.label}
              onChange={(event) => {
                const label = event.target.value;
                // The key follows the label until somebody types a key of their
                // own; after that it is theirs, because a key that keeps
                // re-deriving would silently regroup existing facets.
                update(index, spec.key === toKey(spec.label) || spec.key === '' ? { label, key: toKey(label) } : { label });
              }}
              placeholder="Operating voltage"
              className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <div className="md:col-span-3">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Key
            </label>
            <input
              value={spec.key}
              onChange={(event) => update(index, { key: event.target.value })}
              placeholder="operating-voltage"
              className="h-9 w-full rounded-lg border border-border bg-card px-2 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Value
            </label>
            <input
              value={spec.value}
              onChange={(event) => update(index, { value: event.target.value })}
              placeholder="3.3"
              className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <div className="md:col-span-1">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Unit
            </label>
            <input
              value={spec.unit}
              onChange={(event) => update(index, { unit: event.target.value })}
              placeholder="V"
              className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <div className="flex items-end gap-2 md:col-span-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 pb-2 text-[11px] font-semibold text-muted-foreground">
              <input
                type="checkbox"
                checked={spec.filterable}
                onChange={(event) => update(index, { filterable: event.target.checked })}
                className="h-3.5 w-3.5 rounded border-border"
              />
              Facet
            </label>
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label="Remove specification"
              className="mb-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...specs, emptySpec()])}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Add specification
      </button>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        <span className="font-semibold">Facet</span> marks a spec as filterable, which is what puts
        it in the storefront&apos;s filter sidebar. Products group by <span className="font-mono">key</span>,
        not by label — two products spelling the label differently still group together if the key
        matches. Rows with no key or no value are dropped on save.
      </p>
    </div>
  );
}
