import { getServices } from "@/lib/services";
import { TopBar } from "./layout/header/top-bar";
import { MainHeader } from "./layout/header/main-header";
import { CategoryNav } from "./layout/header/category-nav";

export async function Navbar() {
  const { productService } = await getServices();
  const categories = await productService.getCategoryTree();

  return (
    <header className="flex flex-col w-full bg-background">
      <TopBar />
      <MainHeader categories={categories} />
      <CategoryNav categories={categories} />
    </header>
  );
}

