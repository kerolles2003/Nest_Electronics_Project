'use client';

import { useEffect, useState } from 'react';
import { User, Mail, Phone, Save, Loader2 } from 'lucide-react';
import { getSupabaseBrowserClient } from '@nest/providers';
import { Button } from '@nest/ui';

interface ProfileData {
  full_name: string;
  phone: string;
  email: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData>({
    full_name: '',
    phone: '',
    email: '',
  });
  const [originalFullName, setOriginalFullName] = useState('');
  const [originalPhone, setOriginalPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = getSupabaseBrowserClient() as any;

  useEffect(() => {
    async function loadProfile() {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', user.id)
        .single();

      setProfile({
        full_name: profileData?.full_name ?? '',
        phone: profileData?.phone ?? '',
        email: user.email ?? '',
      });
      setOriginalFullName(profileData?.full_name ?? '');
      setOriginalPhone(profileData?.phone ?? '');
      setLoading(false);
    }

    loadProfile();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    const trimmedName = profile.full_name.trim();
    const trimmedPhone = profile.phone.trim();

    if (!trimmedName) {
      setMessage({ type: 'error', text: 'Full name is required.' });
      return;
    }

    setSaving(true);

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setMessage({ type: 'error', text: 'Not authenticated.' });
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .upsert(
        { id: user.id, full_name: trimmedName, phone: trimmedPhone || null },
        { onConflict: 'id' }
      );

    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({ type: 'success', text: 'Profile updated successfully.' });
      setOriginalFullName(trimmedName);
      setOriginalPhone(trimmedPhone);
    }

    setSaving(false);
  };

  const hasChanges =
    profile.full_name.trim() !== originalFullName ||
    profile.phone.trim() !== originalPhone;

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-gray-900">Profile</h2>
        <div className="bg-white border border-gray-200 rounded-md p-6 space-y-4">
          <div className="h-10 bg-gray-100 rounded-md animate-pulse" />
          <div className="h-10 bg-gray-100 rounded-md animate-pulse" />
          <div className="h-10 bg-gray-100 rounded-md animate-pulse" />
        </div>
      </div>
    );
  }

  if (!profile.email) {
    return (
      <div className="text-center py-16 bg-white border border-gray-200 rounded-md">
        <User className="w-12 h-12 mx-auto text-gray-300 mb-4" />
        <h2 className="text-lg font-medium text-gray-900">Sign in to view your profile</h2>
        <p className="text-gray-500 mt-1">
          Please sign in to access your profile.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Profile</h2>

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-md p-6 space-y-5">
        {message && (
          <div
            className={`rounded-md px-4 py-3 text-sm ${
              message.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="full_name" className="text-sm font-medium text-gray-700">
            Full Name
          </label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              id="full_name"
              type="text"
              value={profile.full_name}
              onChange={(e) =>
                setProfile((p) => ({ ...p, full_name: e.target.value }))
              }
              className="w-full rounded-md border border-gray-200 px-3 py-2 pl-9 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder:text-gray-300"
              placeholder="Your full name"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-gray-700">
            Email
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              id="email"
              type="email"
              value={profile.email}
              disabled
              className="w-full rounded-md border border-gray-200 px-3 py-2 pl-9 text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
            />
          </div>
          <p className="text-xs text-gray-400">
            Email cannot be changed.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="phone" className="text-sm font-medium text-gray-700">
            Phone
          </label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              id="phone"
              type="tel"
              value={profile.phone}
              onChange={(e) =>
                setProfile((p) => ({ ...p, phone: e.target.value }))
              }
              className="w-full rounded-md border border-gray-200 px-3 py-2 pl-9 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder:text-gray-300"
              placeholder="+20 1XX XXX XXXX"
            />
          </div>
        </div>

        <Button type="submit" disabled={!hasChanges || saving}>
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
