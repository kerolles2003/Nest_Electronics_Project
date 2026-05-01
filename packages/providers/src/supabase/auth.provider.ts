import type { SupabaseClient } from '@supabase/supabase-js';
import type { IAuthRepository } from '@nest/repositories';
import type { Profile } from '@nest/types';

export class SupabaseAuthProvider implements IAuthRepository {
  constructor(private client: SupabaseClient) {}

  async getProfile(userId: string): Promise<Profile | null> {
    const { data } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    return data as Profile | null;
  }

  async updateProfile(userId: string, data: Partial<Pick<Profile, 'full_name' | 'phone' | 'avatar_url'>>): Promise<Profile> {
    const { data: profile, error } = await this.client
      .from('profiles')
      .update(data)
      .eq('id', userId)
      .select()
      .single();
      
    if (error) throw new Error(error.message);
    return profile as Profile;
  }

  async isAdmin(userId: string): Promise<boolean> {
    const profile = await this.getProfile(userId);
    return profile?.role === 'admin' || profile?.role === 'super_admin';
  }
}
