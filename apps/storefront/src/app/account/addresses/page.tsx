'use client';

import { useEffect, useState } from 'react';
import { MapPin, Plus, Pencil, Trash2, Loader2, X } from 'lucide-react';
import { getSupabaseBrowserClient } from '@nest/providers';
import { Button, StatusBadge } from '@nest/ui';
import { EGYPTIAN_GOVERNORATES } from '@nest/config/constants';

interface AddressData {
  id: string;
  label: string;
  full_name: string;
  phone: string;
  street: string;
  city: string;
  governorate: string;
  is_default: boolean;
}

interface AddressFormData {
  label: string;
  full_name: string;
  phone: string;
  street: string;
  city: string;
  governorate: string;
}

const emptyForm: AddressFormData = {
  label: '',
  full_name: '',
  phone: '',
  street: '',
  city: '',
  governorate: '',
};

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<AddressData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');

  const supabase = getSupabaseBrowserClient() as any;

  useEffect(() => {
    loadAddresses();
  }, []);

  async function loadAddresses() {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setIsLoading(false);
      return;
    }
    setUserId(user.id);

    const { data } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    setAddresses(data ?? []);
    setIsLoading(false);
  }

  function openAddForm() {
    setForm(emptyForm);
    setEditingId(null);
    setError('');
    setShowForm(true);
  }

  function openEditForm(address: AddressData) {
    setForm({
      label: address.label,
      full_name: address.full_name,
      phone: address.phone,
      street: address.street,
      city: address.city,
      governorate: address.governorate,
    });
    setEditingId(address.id);
    setError('');
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!form.full_name.trim() || !form.phone.trim() || !form.street.trim() || !form.city.trim() || !form.governorate) {
      setError('Please fill in all required fields.');
      return;
    }

    setSaving(true);

    if (editingId) {
      const { error: updateError } = await supabase
        .from("addresses")
        .update({
          label: form.label.trim() || null,
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          street: form.street.trim(),
          city: form.city.trim(),
          governorate: form.governorate,
        })
        .eq("id", editingId);

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }

      setAddresses((prev) =>
        prev.map((a) =>
          a.id === editingId
            ? {
                ...a,
                label: form.label.trim() || a.label,
                full_name: form.full_name.trim(),
                phone: form.phone.trim(),
                street: form.street.trim(),
                city: form.city.trim(),
                governorate: form.governorate,
              }
            : a
        )
      );
    } else {
      const { data: newAddress, error: insertError } = await supabase
        .from('addresses')
        .insert({
          user_id: userId,
          label: form.label.trim() || null,
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          street: form.street.trim(),
          city: form.city.trim(),
          governorate: form.governorate,
          is_default: addresses.length === 0,
        })
        .select()
        .single();

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }

      setAddresses((prev) => [newAddress as AddressData, ...prev]);
    }

    setSaving(false);
    closeForm();
  }

  async function handleDelete(id: string) {
    const { error: deleteError } = await supabase
      .from('addresses')
      .delete()
      .eq('id', id);

    if (!deleteError) {
      setAddresses((prev) => prev.filter((a) => a.id !== id));
    }
  }

  async function handleSetDefault(id: string) {
    const { error: updateError } = await supabase
      .from('addresses')
      .update({ is_default: true })
      .eq('id', id);

    if (updateError) return;

    setAddresses((prev) =>
      prev.map((a) => ({
        ...a,
        is_default: a.id === id,
      }))
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Addresses</h2>
        </div>
        <div className="bg-white border border-gray-200 rounded-md p-6 space-y-3">
          <div className="h-20 bg-gray-100 rounded-md animate-pulse" />
          <div className="h-20 bg-gray-100 rounded-md animate-pulse" />
        </div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="text-center py-16 bg-white border border-gray-200 rounded-md">
        <MapPin className="w-12 h-12 mx-auto text-gray-300 mb-4" />
        <h2 className="text-lg font-medium text-gray-900">Sign in to manage addresses</h2>
        <p className="text-gray-500 mt-1">
          Please sign in to access your addresses.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Addresses</h2>
        {!showForm && (
          <Button variant="outline" size="sm" onClick={openAddForm}>
            <Plus className="w-4 h-4 mr-1" />
            Add Address
          </Button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-md p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">
              {editingId ? 'Edit Address' : 'New Address'}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="addr_label" className="text-sm font-medium text-gray-700">
                Label
              </label>
              <input
                id="addr_label"
                type="text"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder:text-gray-300"
                placeholder="Home, Work, etc."
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="addr_name" className="text-sm font-medium text-gray-700">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                id="addr_name"
                type="text"
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder:text-gray-300"
                placeholder="Recipient name"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="addr_phone" className="text-sm font-medium text-gray-700">
                Phone <span className="text-red-500">*</span>
              </label>
              <input
                id="addr_phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder:text-gray-300"
                placeholder="+20 1XX XXX XXXX"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="addr_street" className="text-sm font-medium text-gray-700">
                Street <span className="text-red-500">*</span>
              </label>
              <input
                id="addr_street"
                type="text"
                value={form.street}
                onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder:text-gray-300"
                placeholder="Street address"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="addr_city" className="text-sm font-medium text-gray-700">
                City <span className="text-red-500">*</span>
              </label>
              <input
                id="addr_city"
                type="text"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder:text-gray-300"
                placeholder="City"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="addr_governorate" className="text-sm font-medium text-gray-700">
                Governorate <span className="text-red-500">*</span>
              </label>
              <select
                id="addr_governorate"
                value={form.governorate}
                onChange={(e) => setForm((f) => ({ ...f, governorate: e.target.value }))}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                required
              >
                <option value="" disabled>
                  Select governorate
                </option>
                {EGYPTIAN_GOVERNORATES.map((gov) => (
                  <option key={gov} value={gov}>
                    {gov}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {editingId ? 'Saving...' : 'Adding...'}
                </>
              ) : (
                <>{editingId ? 'Save Changes' : 'Add Address'}</>
              )}
            </Button>
            <Button type="button" variant="ghost" onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {!showForm && addresses.length === 0 && (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-md">
          <MapPin className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No addresses saved. Add your first address.</h3>
          <p className="text-gray-500 mt-1">
            Save your shipping details for faster checkout.
          </p>
          <Button variant="outline" className="mt-4" onClick={openAddForm}>
            <Plus className="w-4 h-4 mr-1" />
            Add Address
          </Button>
        </div>
      )}

      {!showForm && addresses.length > 0 && (
        <div className="space-y-3">
          {addresses.map((address) => (
            <div key={address.id} className="bg-white border border-gray-200 rounded-md p-5">
              <div className="flex items-center gap-2 mb-2">
                {address.is_default && (
                  <StatusBadge status="Default" />
                )}
                {address.label && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    {address.label}
                  </span>
                )}
              </div>
              <div className="text-sm space-y-1">
                <p className="font-medium text-gray-900">{address.full_name}</p>
                <p className="text-gray-500">{address.phone}</p>
                <p className="text-gray-500">{address.street}</p>
                <p className="text-gray-500">
                  {address.city}, {address.governorate}
                </p>
              </div>
              <div className="flex items-center gap-1 mt-4 pt-3 border-t border-gray-100">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditForm(address)}
                >
                  <Pencil className="w-4 h-4 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(address.id)}
                  className="text-red-500 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete
                </Button>
                {!address.is_default && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSetDefault(address.id)}
                  >
                    Set as Default
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
