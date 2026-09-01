'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Plus, Pencil, Trash2, Loader2, X, FolderTree, CheckCircle2, XCircle, Layers, GitBranch, FolderOpen, Search } from 'lucide-react'
import { useToast, StatusBadge } from '@nest/ui'
import type { Category } from '@nest/types'
import {
  createCategoryAction,
  updateCategoryAction,
  softDeleteCategoryAction,
} from '@/actions/category-brand.actions'

interface Props {
  initialCategories: Category[]
  stats: {
    total: number
    active: number
    inactive: number
    topLevel: number
    withChildren: number
  }
  activeIds: Set<string>
}

interface CategoryFormData {
  id?: string
  name_en: string
  name_ar: string
  slug: string
  parent_id: string
  sort_order: number
  image_url: string
  is_active: boolean
}

const emptyForm: CategoryFormData = {
  name_en: '',
  name_ar: '',
  slug: '',
  parent_id: '',
  sort_order: 0,
  image_url: '',
  is_active: true,
}

function generateSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function getDepth(id: string, all: Category[]): number {
  const cat = all.find(c => c.id === id)
  if (!cat || !cat.parent_id) return 0
  return 1 + getDepth(cat.parent_id, all)
}

export function CategoriesManager({ initialCategories, stats, activeIds }: Props) {
  const { addToast } = useToast()
  const [categories, setCategories] = useState(initialCategories)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addForm, setAddForm] = useState<CategoryFormData>({ ...emptyForm })
  const [editForm, setEditForm] = useState<CategoryFormData>({ ...emptyForm })
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = categories.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.name_en.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q) || (c.name_ar ?? '').toLowerCase().includes(q)
  })

  const sorted = [...filtered].sort((a, b) => {
    if (!a.deleted_at && b.deleted_at) return -1
    if (a.deleted_at && !b.deleted_at) return 1
    return a.sort_order - b.sort_order
  })

  const handleCreate = async () => {
    setLoading(true)
    try {
      const fd = new FormData()
      fd.set('name_en', addForm.name_en)
      fd.set('name_ar', addForm.name_ar)
      fd.set('slug', addForm.slug || generateSlug(addForm.name_en))
      fd.set('parent_id', addForm.parent_id)
      fd.set('sort_order', addForm.sort_order.toString())
      fd.set('image_url', addForm.image_url)
      fd.set('is_active', addForm.is_active.toString())

      const result = await createCategoryAction(fd)
      if (result.success) {
        addToast('Category created', 'success')
        setShowAddForm(false)
        setAddForm({ ...emptyForm })
        window.location.reload()
      } else {
        addToast(result.error ?? 'Failed to create category', 'error')
      }
    } catch {
      addToast('Failed to create category', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async (id: string) => {
    setLoading(true)
    try {
      const fd = new FormData()
      fd.set('id', id)
      fd.set('name_en', editForm.name_en)
      fd.set('name_ar', editForm.name_ar)
      fd.set('slug', editForm.slug)
      fd.set('parent_id', editForm.parent_id)
      fd.set('sort_order', editForm.sort_order.toString())
      fd.set('is_active', editForm.is_active.toString())

      const result = await updateCategoryAction(fd)
      if (result.success) {
        addToast('Category updated', 'success')
        setEditingId(null)
        window.location.reload()
      } else {
        addToast(result.error ?? 'Failed to update category', 'error')
      }
    } catch {
      addToast('Failed to update category', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this category?')) return
    setDeletingId(id)
    try {
      const result = await softDeleteCategoryAction(id)
      if (result.success) {
        addToast('Category deleted', 'success')
        setCategories((prev) =>
          prev.map((c) =>
            c.id === id ? { ...c, deleted_at: new Date().toISOString() } : c
          )
        )
      } else {
        addToast(result.error ?? 'Failed to delete category', 'error')
      }
    } catch {
      addToast('Failed to delete category', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const startEdit = (cat: Category) => {
    setEditForm({
      id: cat.id,
      name_en: cat.name_en,
      name_ar: cat.name_ar ?? '',
      slug: cat.slug,
      parent_id: cat.parent_id ?? '',
      sort_order: cat.sort_order,
      image_url: cat.image_url ?? '',
      is_active: cat.is_active,
    })
    setEditingId(cat.id)
    setShowAddForm(false)
  }

  const colorMap: Record<string, { bg: string; text: string; border: string; ring: string }> = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', ring: 'ring-emerald-500/30' },
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', ring: 'ring-blue-500/30' },
    gray: { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20', ring: 'ring-gray-500/30' },
    violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20', ring: 'ring-violet-500/30' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20', ring: 'ring-orange-500/30' },
  }

  return (
    <div className="space-y-5">
      {/* Stats Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: stats.total, icon: FolderTree, color: 'blue' as const },
          { label: 'Active', value: stats.active, icon: CheckCircle2, color: 'emerald' as const },
          { label: 'Inactive', value: stats.inactive, icon: XCircle, color: 'gray' as const },
          { label: 'Top-Level', value: stats.topLevel, icon: Layers, color: 'violet' as const },
          { label: 'With Children', value: stats.withChildren, icon: GitBranch, color: 'orange' as const },
        ].map((item) => {
          const Icon = item.icon
          const colors = colorMap[item.color]
          return (
            <div key={item.label} className={`rounded-xl border ${colors.border} bg-card p-3`}>
              <div className="flex items-center justify-between mb-2">
                <div className={`rounded-lg p-1.5 ${colors.bg}`}>
                  <Icon className={`h-3.5 w-3.5 ${colors.text}`} />
                </div>
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{item.label}</p>
              <p className="text-lg font-bold tracking-tight text-foreground mt-0.5">{item.value}</p>
            </div>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10 transition-all outline-none"
          />
        </div>
        <button
          onClick={() => {
            setShowAddForm(true)
            setEditingId(null)
            setAddForm({ ...emptyForm, sort_order: categories.length })
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all shrink-0"
        >
          <Plus className="h-4 w-4" />
          Add Category
        </button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-card shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">New Category</h3>
            <button onClick={() => setShowAddForm(false)} className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Name EN *</label>
              <input
                value={addForm.name_en}
                onChange={(e) => setAddForm({ ...addForm, name_en: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                placeholder="Category name"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Name AR</label>
              <input
                value={addForm.name_ar}
                onChange={(e) => setAddForm({ ...addForm, name_ar: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-right focus:ring-2 focus:ring-primary/10 outline-none"
                placeholder="اسم الفئة"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Slug *</label>
              <input
                value={addForm.slug}
                onChange={(e) => setAddForm({ ...addForm, slug: e.target.value })}
                placeholder={generateSlug(addForm.name_en)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-mono focus:ring-2 focus:ring-primary/10 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Parent</label>
              <select
                value={addForm.parent_id}
                onChange={(e) => setAddForm({ ...addForm, parent_id: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
              >
                <option value="">None (top-level)</option>
                {categories.filter(c => !c.deleted_at).map((c) => (
                  <option key={c.id} value={c.id}>{c.name_en}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Sort Order</label>
              <input
                type="number"
                value={addForm.sort_order}
                onChange={(e) => setAddForm({ ...addForm, sort_order: parseInt(e.target.value) || 0 })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Image URL</label>
              <input
                value={addForm.image_url}
                onChange={(e) => setAddForm({ ...addForm, image_url: e.target.value })}
                placeholder="https://..."
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer h-9">
                <input
                  type="checkbox"
                  checked={addForm.is_active}
                  onChange={(e) => setAddForm({ ...addForm, is_active: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                Active
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowAddForm(false)} className="rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={loading} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 inline-flex items-center gap-1.5">
              {loading && <Loader2 className="w-3 h-3 animate-spin" />}
              Create Category
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Slug</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Parent</th>
                <th className="px-5 py-3 text-center text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Sort</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <FolderOpen className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {search ? 'No categories match your search' : 'No categories found'}
                      </p>
                      <p className="text-xs text-muted-foreground/60">
                        {search ? 'Try a different search term.' : 'Add your first category to organize products.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                sorted.map((cat) => {
                  const depth = getDepth(cat.id, categories)
                  const isEditing = editingId === cat.id

                  if (isEditing) {
                    return (
                      <tr key={cat.id}>
                        <td colSpan={6} className="px-5 py-4 bg-primary/5">
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end">
                            <div>
                              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Name EN</label>
                              <input
                                value={editForm.name_en}
                                onChange={(e) => setEditForm({ ...editForm, name_en: e.target.value })}
                                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Name AR</label>
                              <input
                                value={editForm.name_ar}
                                onChange={(e) => setEditForm({ ...editForm, name_ar: e.target.value })}
                                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-right focus:ring-2 focus:ring-primary/10 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Slug</label>
                              <input
                                value={editForm.slug}
                                onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })}
                                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm font-mono focus:ring-2 focus:ring-primary/10 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Parent</label>
                              <select
                                value={editForm.parent_id}
                                onChange={(e) => setEditForm({ ...editForm, parent_id: e.target.value })}
                                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                              >
                                <option value="">None</option>
                                {categories.filter(c => !c.deleted_at && c.id !== cat.id).map((c) => (
                                  <option key={c.id} value={c.id}>{c.name_en}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Sort</label>
                              <input
                                type="number"
                                value={editForm.sort_order}
                                onChange={(e) => setEditForm({ ...editForm, sort_order: parseInt(e.target.value) || 0 })}
                                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editForm.is_active}
                                  onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                                  className="h-4 w-4 rounded border-border"
                                />
                                Active
                              </label>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleUpdate(cat.id)}
                                disabled={loading}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50"
                              >
                                {loading && <Loader2 className="w-3 h-3 animate-spin" />}
                                Save
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <tr
                      key={cat.id}
                      className={`hover:bg-muted/20 transition-colors ${cat.deleted_at ? 'opacity-40' : ''}`}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 16}px` }}>
                          {depth > 0 && (
                            <GitBranch className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                          )}
                          <div className="flex items-center gap-2">
                            {cat.image_url ? (
                              <div className="relative h-8 w-8 rounded-lg border border-border overflow-hidden shrink-0 bg-muted">
                                <Image src={cat.image_url} alt="" fill sizes="32px" className="object-cover" />
                              </div>
                            ) : (
                              <div className="h-8 w-8 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
                                <FolderTree className="h-3.5 w-3.5 text-muted-foreground/40" />
                              </div>
                            )}
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-semibold text-foreground truncate">{cat.name_en}</span>
                              {cat.name_ar && (
                                <span className="text-[11px] text-muted-foreground truncate text-right">{cat.name_ar}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground font-mono text-xs">
                        {cat.slug}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground text-xs">
                        {cat.parent_id
                          ? categories.find((c) => c.id === cat.parent_id)?.name_en ?? '-'
                          : <span className="text-muted-foreground/50">Top-level</span>}
                      </td>
                      <td className="px-5 py-3 text-center">
                        {cat.deleted_at ? (
                          <StatusBadge status="Deleted" />
                        ) : cat.is_active ? (
                          <StatusBadge status="Active" />
                        ) : (
                          <StatusBadge status="Inactive" />
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-muted-foreground">
                        {cat.sort_order}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEdit(cat)}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all"
                            title="Edit category"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(cat.id)}
                            disabled={deletingId === cat.id || !!cat.deleted_at}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400 transition-all disabled:opacity-30"
                            title="Delete category"
                          >
                            {deletingId === cat.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
