'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, Loader2, X, Tag, CheckCircle2, XCircle, ImageIcon, Search, AlertTriangle } from 'lucide-react'
import { useToast, StatusBadge } from '@nest/ui'
import type { Brand } from '@nest/types'
import {
  createBrandAction,
  updateBrandAction,
  softDeleteBrandAction,
} from '@/actions/category-brand.actions'

interface Props {
  initialBrands: Brand[]
  stats: {
    total: number
    active: number
    inactive: number
    deleted: number
    withLogo: number
  }
}

interface BrandFormData {
  id?: string
  name_en: string
  name_ar: string
  slug: string
  logo_url: string
  is_active: boolean
}

const emptyForm: BrandFormData = {
  name_en: '',
  name_ar: '',
  slug: '',
  logo_url: '',
  is_active: true,
}

function generateSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function BrandsManager({ initialBrands, stats }: Props) {
  const { addToast } = useToast()
  const [brands, setBrands] = useState(initialBrands)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addForm, setAddForm] = useState<BrandFormData>({ ...emptyForm })
  const [editForm, setEditForm] = useState<BrandFormData>({ ...emptyForm })
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = brands.filter(b => {
    if (!search) return true
    const q = search.toLowerCase()
    return b.name_en.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q)
  })

  const sorted = [...filtered].sort((a, b) => {
    if (!a.deleted_at && b.deleted_at) return -1
    if (a.deleted_at && !b.deleted_at) return 1
    return a.name_en.localeCompare(b.name_en)
  })

  const handleCreate = async () => {
    setLoading(true)
    try {
      const fd = new FormData()
      fd.set('name_en', addForm.name_en)
      fd.set('name_ar', addForm.name_ar)
      fd.set('slug', addForm.slug || generateSlug(addForm.name_en))
      fd.set('logo_url', addForm.logo_url)
      fd.set('is_active', addForm.is_active.toString())

      const result = await createBrandAction(fd)
      if (result.success) {
        addToast('Brand created', 'success')
        setShowAddForm(false)
        setAddForm({ ...emptyForm })
        window.location.reload()
      } else {
        addToast(result.error ?? 'Failed to create brand', 'error')
      }
    } catch {
      addToast('Failed to create brand', 'error')
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
      fd.set('logo_url', editForm.logo_url)
      fd.set('is_active', editForm.is_active.toString())

      const result = await updateBrandAction(fd)
      if (result.success) {
        addToast('Brand updated', 'success')
        setEditingId(null)
        window.location.reload()
      } else {
        addToast(result.error ?? 'Failed to update brand', 'error')
      }
    } catch {
      addToast('Failed to update brand', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this brand?')) return
    setDeletingId(id)
    try {
      const result = await softDeleteBrandAction(id)
      if (result.success) {
        addToast('Brand deleted', 'success')
        setBrands((prev) =>
          prev.map((b) =>
            b.id === id ? { ...b, deleted_at: new Date().toISOString() } : b
          )
        )
      } else {
        addToast(result.error ?? 'Failed to delete brand', 'error')
      }
    } catch {
      addToast('Failed to delete brand', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const startEdit = (brand: Brand) => {
    setEditForm({
      id: brand.id,
      name_en: brand.name_en,
      name_ar: brand.name_ar ?? '',
      slug: brand.slug,
      logo_url: brand.logo_url ?? '',
      is_active: brand.is_active,
    })
    setEditingId(brand.id)
    setShowAddForm(false)
  }

  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
    gray: { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20' },
    violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
  }

  return (
    <div className="space-y-5">
      {/* Stats Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: stats.total, icon: Tag, color: 'blue' as const },
          { label: 'Active', value: stats.active, icon: CheckCircle2, color: 'emerald' as const },
          { label: 'Inactive', value: stats.inactive, icon: XCircle, color: 'gray' as const },
          { label: 'Deleted', value: stats.deleted, icon: AlertTriangle, color: 'rose' as const },
          { label: 'With Logo', value: stats.withLogo, icon: ImageIcon, color: 'violet' as const },
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
            placeholder="Search brands..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10 transition-all outline-none"
          />
        </div>
        <button
          onClick={() => {
            setShowAddForm(true)
            setEditingId(null)
            setAddForm({ ...emptyForm })
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all shrink-0"
        >
          <Plus className="h-4 w-4" />
          Add Brand
        </button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-card shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">New Brand</h3>
            <button onClick={() => setShowAddForm(false)} className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Name EN *</label>
              <input
                value={addForm.name_en}
                onChange={(e) => setAddForm({ ...addForm, name_en: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 outline-none"
                placeholder="Brand name"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Name AR</label>
              <input
                value={addForm.name_ar}
                onChange={(e) => setAddForm({ ...addForm, name_ar: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-right focus:ring-2 focus:ring-primary/10 outline-none"
                placeholder="اسم العلامة التجارية"
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
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Logo URL</label>
              <input
                value={addForm.logo_url}
                onChange={(e) => setAddForm({ ...addForm, logo_url: e.target.value })}
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
              Create Brand
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
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider w-14">Logo</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Slug</th>
                <th className="px-5 py-3 text-center text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Tag className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {search ? 'No brands match your search' : 'No brands found'}
                      </p>
                      <p className="text-xs text-muted-foreground/60">
                        {search ? 'Try a different search term.' : 'Add your first brand to get started.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                  sorted.map((brand) => {
                    const isEditing = editingId === brand.id

                  if (isEditing) {
                    return (
                      <tr key={brand.id}>
                        <td colSpan={5} className="px-5 py-4 bg-primary/5">
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
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
                              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Logo URL</label>
                              <input
                                value={editForm.logo_url}
                                onChange={(e) => setEditForm({ ...editForm, logo_url: e.target.value })}
                                placeholder="https://..."
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
                              <div className="flex items-center gap-2 ml-auto">
                                <button
                                  onClick={() => handleUpdate(brand.id)}
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
                          </div>
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <tr
                      key={brand.id}
                      className={`hover:bg-muted/20 transition-colors group ${brand.deleted_at ? 'opacity-40' : ''}`}
                    >
                      <td className="px-5 py-3">
                        {brand.logo_url ? (
                          <div className="h-10 w-10 rounded-lg border border-border overflow-hidden bg-muted flex items-center justify-center shrink-0">
                            <img
                              src={brand.logo_url}
                              alt={brand.name_en}
                              className="h-full w-full object-contain p-1"
                            />
                          </div>
                        ) : (
                          <div className="h-10 w-10 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
                            <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-foreground truncate">{brand.name_en}</span>
                          {brand.name_ar && (
                            <span className="text-[11px] text-muted-foreground truncate text-right">{brand.name_ar}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground font-mono text-xs">
                        {brand.slug}
                      </td>
                      <td className="px-5 py-3 text-center">
                        {brand.deleted_at ? (
                          <StatusBadge status="Deleted" />
                        ) : brand.is_active ? (
                          <StatusBadge status="Active" />
                        ) : (
                          <StatusBadge status="Inactive" />
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEdit(brand)}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all"
                            title="Edit brand"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(brand.id)}
                            disabled={deletingId === brand.id || !!brand.deleted_at}
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400 transition-all disabled:opacity-30"
                            title="Delete brand"
                          >
                            {deletingId === brand.id ? (
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
