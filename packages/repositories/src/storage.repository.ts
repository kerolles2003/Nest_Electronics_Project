export interface IStorageRepository {
  uploadFile(bucket: string, path: string, file: File | Blob, contentType?: string): Promise<string>;
  getPublicUrl(bucket: string, path: string): string;
  deleteFile(bucket: string, path: string): Promise<void>;
}
