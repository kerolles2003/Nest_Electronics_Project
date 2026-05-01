import type { IStorageRepository } from '@nest/repositories';

export class StorageService {
  constructor(private storageRepo: IStorageRepository) {}

  async uploadProductImage(productId: string, file: File | Blob, fileName: string, contentType?: string): Promise<string> {
    const path = `products/${productId}/${Date.now()}-${fileName}`;
    return this.storageRepo.uploadFile('images', path, file, contentType);
  }

  getPublicImageUrl(path: string): string {
    return this.storageRepo.getPublicUrl('images', path);
  }

  async deleteImage(path: string): Promise<void> {
    return this.storageRepo.deleteFile('images', path);
  }
}
