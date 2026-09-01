'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Image from 'next/image';
import { X, Upload, Image as ImageIcon, Star, GripVertical, Loader2 } from 'lucide-react';
import { Button } from '@nest/ui';
import { deleteProductImageAction, reorderProductImagesAction, setPrimaryImageAction } from '@/actions/product.actions';

interface ProductImage {
  id: string;
  url: string;
  is_primary: boolean;
  sort_order: number;
}

type ImageItem =
  | { type: 'existing'; uid: string; id: string; url: string; isPrimary: boolean }
  | { type: 'new'; uid: string; file: File; previewUrl: string; isPrimary: boolean };

interface ProductImageUploadProps {
  productId?: string;
  initialImages?: ProductImage[];
  onImagesChange?: (files: File[]) => void;
}

const MAX_IMAGES = 8;
const MAX_SIZE_MB = 5;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function generateUid() {
  return Math.random().toString(36).slice(2, 10);
}

function validateFile(file: File): { ok: boolean; error?: string } {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: `${file.name}: Only JPEG, PNG, WebP allowed` };
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return { ok: false, error: `${file.name}: Max ${MAX_SIZE_MB}MB` };
  }
  return { ok: true };
}

export function ProductImageUpload({ productId, initialImages = [], onImagesChange }: ProductImageUploadProps) {
  const [items, setItems] = useState<ImageItem[]>(() => {
    const sorted = [...initialImages].sort((a, b) => a.sort_order - b.sort_order);
    return sorted.map((img) => ({
      type: 'existing' as const,
      uid: `existing-${img.id}`,
      id: img.id,
      url: img.url,
      isPrimary: img.is_primary,
    }));
  });
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingUid, setDraggingUid] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const totalCount = items.length;

  useEffect(() => {
    const newFiles = items
      .filter((i): i is ImageItem & { type: 'new' } => i.type === 'new')
      .map((i) => i.file);
    onImagesChange?.(newFiles);
  }, [items, onImagesChange]);



  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const fileArray = Array.from(files);
    const errors: string[] = [];
    const newItems: ImageItem[] = [];

    setItems((prev) => {
      let currentCount = prev.length;
      for (const file of fileArray) {
        if (currentCount >= MAX_IMAGES) {
          errors.push(`Max ${MAX_IMAGES} images allowed`);
          break;
        }
        const validation = validateFile(file);
        if (!validation.ok) {
          errors.push(validation.error!);
          continue;
        }
        const previewUrl = URL.createObjectURL(file);
        newItems.push({
          type: 'new',
          uid: `new-${generateUid()}`,
          file,
          previewUrl,
          isPrimary: currentCount === 0 && prev.length === 0,
        });
        currentCount++;
      }
      return [...prev, ...newItems];
    });

    if (errors.length > 0) {
      setValidationError(errors.join(', '));
      setTimeout(() => setValidationError(null), 4000);
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDropZoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOverIndex(null);
    addFiles(e.dataTransfer.files);
  };

  const handleDropZoneDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDropZoneDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragOverIndex(-1);
  };

  const handleDropZoneDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOverIndex(null);
    }
  };

  const removeItem = async (uid: string) => {
    const item = items.find((i) => i.uid === uid);
    if (!item) return;

    if (item.type === 'existing') {
      if (!productId) return;
      setDeletingId(item.id);
      const result = await deleteProductImageAction(item.id, `/admin/products/${productId}/edit`);
      setDeletingId(null);
      if (!result.success) {
        setValidationError('Failed to delete image');
        setTimeout(() => setValidationError(null), 3000);
        return;
      }
    } else {
      URL.revokeObjectURL(item.previewUrl);
    }

    setItems((prev) => {
      const idx = prev.findIndex((i) => i.uid === uid);
      const next = prev.filter((i) => i.uid !== uid);
      // If removed primary, make first remaining primary
      if (item.isPrimary && next.length > 0 && !next.some((i) => i.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  };

  const setPrimary = async (uid: string) => {
    const item = items.find((i) => i.uid === uid);
    if (!item || item.isPrimary) return;

    // Optimistic update
    setItems((prev) => prev.map((i) => ({ ...i, isPrimary: i.uid === uid })));

    if (item.type === 'existing' && productId) {
      await setPrimaryImageAction(productId, item.id);
    }
  };

  const handleDragStart = (e: React.DragEvent, uid: string) => {
    setDraggingUid(uid);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverItem = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggingUid && items[index]?.uid !== draggingUid) {
      setDragOverIndex(index);
    }
  };

  const handleDropOnItem = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (!draggingUid) return;
    const dragIndex = items.findIndex((i) => i.uid === draggingUid);
    if (dragIndex === -1 || dragIndex === dropIndex) {
      setDraggingUid(null);
      setDragOverIndex(null);
      return;
    }

    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(dropIndex, 0, moved);
      return next;
    });

    setDraggingUid(null);
    setDragOverIndex(null);

    // Save order for existing images immediately
    if (productId) {
      setSavingOrder(true);
      const newOrder = items.map((i, idx) => ({ imageId: (i as any).id, sortOrder: idx })).filter((o) => o.imageId);
      if (newOrder.length > 0) {
        await reorderProductImagesAction(productId, newOrder);
      }
      setSavingOrder(false);
    }
  };

  const isDropZoneActive = dragOverIndex === -1;

  return (
    <div
      className="space-y-3"
      onDrop={handleDropZoneDrop}
      onDragOver={handleDropZoneDragOver}
      onDragEnter={handleDropZoneDragEnter}
      onDragLeave={handleDropZoneDragLeave}
    >
      {/* Validation Error */}
      {validationError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
          <AlertIcon className="h-3.5 w-3.5 shrink-0" />
          {validationError}
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
        {items.map((item, index) => {
          const isDragging = draggingUid === item.uid;
          const isOver = dragOverIndex === index && draggingUid !== item.uid;
          return (
            <div
              key={item.uid}
              draggable
              onDragStart={(e) => handleDragStart(e, item.uid)}
              onDragOver={(e) => handleDragOverItem(e, index)}
              onDrop={(e) => handleDropOnItem(e, index)}
              className={`
                relative aspect-square rounded-xl border overflow-hidden group cursor-move select-none
                ${item.isPrimary ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'border-border'}
                ${isDragging ? 'opacity-40 scale-95' : 'opacity-100'}
                ${isOver ? 'ring-2 ring-dashed ring-primary/50' : ''}
                transition-all
              `}
            >
              <Image
                src={item.type === 'existing' ? item.url : item.previewUrl}
                alt="Product"
                fill
                className="object-cover pointer-events-none"
                sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, (max-width: 1024px) 20vw, 16vw"
              />

              {/* Hover Overlay */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                {/* Drag handle hint */}
                <GripVertical className="h-4 w-4 text-white/60 mb-1" />

                {/* Primary Toggle */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPrimary(item.uid); }}
                  className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold transition-colors ${
                    item.isPrimary
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-white/20 text-white hover:bg-white/30'
                  }`}
                  title={item.isPrimary ? 'Primary image' : 'Set as primary'}
                >
                  <Star className={`h-3 w-3 ${item.isPrimary ? 'fill-current' : ''}`} />
                  {item.isPrimary ? 'PRIMARY' : 'Set Primary'}
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeItem(item.uid); }}
                  disabled={deletingId === (item.type === 'existing' ? item.id : undefined)}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold bg-white/20 text-white hover:bg-destructive/80 transition-colors disabled:opacity-50"
                >
                  {deletingId === (item.type === 'existing' ? item.id : undefined) ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                  Remove
                </button>
              </div>

              {/* Primary Badge (always visible) */}
              {item.isPrimary && (
                <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground shadow-sm">
                  <Star className="h-2.5 w-2.5 fill-current" />
                  PRIMARY
                </div>
              )}

              {/* New badge */}
              {item.type === 'new' && (
                <div className="absolute bottom-1.5 right-1.5 rounded-full bg-success/90 px-1.5 py-0.5 text-[9px] font-bold text-success-foreground">
                  NEW
                </div>
              )}
            </div>
          );
        })}

        {/* Add Image Button */}
        {totalCount < MAX_IMAGES && (
          <label
            className={`
              relative aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all
              ${isDropZoneActive
                ? 'border-primary bg-primary/10'
                : 'border-muted-foreground/20 hover:border-primary/40 hover:bg-primary/5'
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileInput}
            />
            <div className="p-2 rounded-full bg-muted group-hover:bg-primary/10 transition-colors">
              <Upload className="h-5 w-5 text-muted-foreground" />
            </div>
            <span className="text-[10px] font-semibold text-muted-foreground text-center px-2">
              {isDropZoneActive ? 'Drop here' : `Add Image (${totalCount}/${MAX_IMAGES})`}
            </span>
          </label>
        )}
      </div>

      {/* Footer info */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Drag to reorder. Click star to set primary.</span>
        {savingOrder && (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving order...
          </span>
        )}
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-border rounded-2xl bg-muted/10 text-muted-foreground">
          <ImageIcon className="h-8 w-8 mb-2 opacity-20" />
          <p className="text-sm font-medium">No images yet</p>
          <p className="text-xs opacity-60">Drag & drop or click to upload up to {MAX_IMAGES} images</p>
        </div>
      )}
    </div>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
