import type { IProductRepository, ICategoryRepository, IBrandRepository } from '@nest/repositories';
import type { Product, Category, Brand, ProductFilters, PaginatedResult, Pagination } from '@nest/types';

export class ProductService {
  constructor(
    private productRepo: IProductRepository,
    private categoryRepo: ICategoryRepository,
    private brandRepo: IBrandRepository,
  ) {}

  async getProductPage(slug: string): Promise<Product | null> {
    return this.productRepo.findBySlug(slug);
  }

  async getProductById(id: string): Promise<Product | null> {
    return this.productRepo.findById(id);
  }

  async getProductByIdAdmin(id: string): Promise<Product | null> {
    return this.productRepo.findById(id, true);
  }

  async listProducts(filters: ProductFilters, pagination: Pagination): Promise<PaginatedResult<Product>> {
    return this.productRepo.findMany(filters, pagination);
  }

  async getFeaturedProducts(limit = 8): Promise<Product[]> {
    return this.productRepo.findFeatured(limit);
  }

  async getNewArrivals(limit = 8): Promise<Product[]> {
    return this.productRepo.findNewArrivals(limit);
  }

  async getBestSelling(limit = 8): Promise<Product[]> {
    return this.productRepo.findBestSelling(limit);
  }

  async getCategoryTree(): Promise<Category[]> {
    return this.categoryRepo.findTree();
  }

  async getCategoryBySlug(slug: string): Promise<Category | null> {
    return this.categoryRepo.findBySlug(slug);
  }

  async getAllBrands(): Promise<Brand[]> {
    return this.brandRepo.findAll();
  }

  async getBrandBySlug(slug: string): Promise<Brand | null> {
    return this.brandRepo.findBySlug(slug);
  }
}
