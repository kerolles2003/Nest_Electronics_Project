import type { Profile } from '@nest/types';

export interface IAuthRepository {
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, data: Partial<Pick<Profile, 'full_name' | 'phone' | 'avatar_url'>>): Promise<Profile>;
  isAdmin(userId: string): Promise<boolean>;
}
