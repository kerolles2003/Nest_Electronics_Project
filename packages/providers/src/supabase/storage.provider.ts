import type { SupabaseClient } from '@supabase/supabase-js';
import type { IStorageRepository } from '@nest/repositories';

export class SupabaseStorageProvider implements IStorageRepository {
  constructor(private client: SupabaseClient) {}

  async uploadFile(bucket: string, path: string, file: File | Blob, contentType?: string): Promise<string> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: true,
        contentType,
      });

    if (error) {
      throw new Error(`Failed to upload file to ${bucket}: ${error.message}`);
    }

    return data.path;
  }

  getPublicUrl(bucket: string, path: string): string {
    const { data } = this.client.storage
      .from(bucket)
      .getPublicUrl(path);
      
    return data.publicUrl;
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    const { error } = await this.client.storage
      .from(bucket)
      .remove([path]);

    if (error) {
      throw new Error(`Failed to delete file from ${bucket}: ${error.message}`);
    }
  }
}
