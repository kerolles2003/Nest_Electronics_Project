'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Cpu } from 'lucide-react';

interface AttributeValue {
  id: string;
  attribute_id: string;
  value_en: string;
  value_ar?: string | null;
}

interface Attribute {
  id: string;
  name_en: string;
  name_ar?: string | null;
  slug: string;
  type: string;
  unit: string | null;
  is_filterable: boolean;
  is_comparable: boolean;
  values?: AttributeValue[];
}

interface ProductAttributeRow {
  attributeId: string;
  attributeValueId: string | null;
  customValue: string;
}

interface AttributeEditorProps {
  categoryId: string | null;
  initialValues?: Array<{
    attribute_id: string;
    attribute_value_id: string | null;
    custom_value: string | null;
    attribute?: Attribute;
    value?: AttributeValue;
  }>;
}

export function AttributeEditor({ categoryId, initialValues = [] }: AttributeEditorProps) {
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [rows, setRows] = useState<ProductAttributeRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Convert initial values to rows
  useEffect(() => {
    if (initialValues.length > 0) {
      setRows(
        initialValues.map((iv) => ({
          attributeId: iv.attribute_id,
          attributeValueId: iv.attribute_value_id,
          customValue: iv.custom_value ?? '',
        }))
      );
    }
  }, [initialValues]);

  // Fetch attributes when category changes
  useEffect(() => {
    if (!categoryId) {
      setAttributes([]);
      return;
    }
    setLoading(true);
    fetch(`/api/attributes?categoryId=${encodeURIComponent(categoryId)}`)
      .then((res) => res.json())
      .then((data) => {
        setAttributes(data.attributes ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [categoryId]);

  const addRow = useCallback((attributeId: string) => {
    setRows((prev) => [...prev, { attributeId, attributeValueId: null, customValue: '' }]);
  }, []);

  const removeRow = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateRow = useCallback((index: number, updates: Partial<ProductAttributeRow>) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, []);

  const getAttributeById = useCallback(
    (id: string) => attributes.find((a) => a.id === id),
    [attributes]
  );

  const getAvailableAttributes = useCallback(() => {
    const usedIds = new Set(rows.map((r) => r.attributeId));
    return attributes.filter((a) => !usedIds.has(a.id));
  }, [attributes, rows]);

  const available = getAvailableAttributes();

  // Build JSON for form submission
  const attributeValuesJson = JSON.stringify(
    rows.map((r) => ({
      attribute_id: r.attributeId,
      attribute_value_id: r.attributeValueId,
      custom_value: r.customValue || null,
    }))
  );

  if (!categoryId) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
        <Cpu className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Select a category to manage technical specifications</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-muted-foreground mt-2">Loading specifications...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input type="hidden" name="attribute_values" value={attributeValuesJson} />

      {rows.length === 0 && attributes.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
          <Cpu className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No specifications defined for this category</p>
        </div>
      )}

      {rows.length === 0 && attributes.length > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center">
          <p className="text-sm text-muted-foreground">No specifications added yet</p>
        </div>
      )}

      {rows.map((row, index) => {
        const attr = getAttributeById(row.attributeId);
        const hasPredefinedValues = attr && attr.values && attr.values.length > 0;
        return (
          <div
            key={`${row.attributeId}-${index}`}
            className="flex items-center gap-2 rounded-lg border border-border bg-background p-2 group"
          >
            {/* Attribute Name */}
            <div className="min-w-[140px] max-w-[180px] shrink-0">
              <span className="text-xs font-semibold text-foreground truncate block" title={attr?.name_en}>
                {attr?.name_en ?? 'Unknown'}
              </span>
              {attr?.unit && (
                <span className="text-[10px] text-muted-foreground">Unit: {attr.unit}</span>
              )}
            </div>

            {/* Value Input */}
            <div className="flex-1 min-w-0">
              {hasPredefinedValues ? (
                <select
                  value={row.attributeValueId ?? ''}
                  onChange={(e) =>
                    updateRow(index, {
                      attributeValueId: e.target.value || null,
                      customValue: '',
                    })
                  }
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus:ring-1 focus:ring-primary/20 outline-none"
                >
                  <option value="">Select value...</option>
                  {attr.values!.map((v) => (
                    <option key={v.id} value={v.id}>{v.value_en}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={row.customValue}
                  onChange={(e) =>
                    updateRow(index, {
                      customValue: e.target.value,
                      attributeValueId: null,
                    })
                  }
                  placeholder={attr?.type === 'number' ? '0.00' : 'Enter value...'}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus:ring-1 focus:ring-primary/20 outline-none"
                />
              )}
            </div>

            {/* Unit Badge */}
            {attr?.unit && (
              <span className="shrink-0 text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {attr.unit}
              </span>
            )}

            {/* Filterable Badge */}
            {attr?.is_filterable && (
              <span className="shrink-0 text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                FILTER
              </span>
            )}

            {/* Delete */}
            <button
              type="button"
              onClick={() => removeRow(index)}
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Remove specification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      {/* Add Row */}
      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) {
                addRow(e.target.value);
                e.target.value = '';
              }
            }}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs focus:ring-1 focus:ring-primary/20 outline-none appearance-none min-w-[200px]"
          >
            <option value="">+ Add specification...</option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>{a.name_en}</option>
            ))}
          </select>
        </div>
      )}

      {available.length === 0 && rows.length > 0 && (
        <p className="text-[11px] text-muted-foreground">All available specifications added.</p>
      )}
    </div>
  );
}
