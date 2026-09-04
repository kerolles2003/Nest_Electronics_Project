import Link from 'next/link';
import { Cpu } from 'lucide-react';
import { SearchBar } from './search-bar';
import { CartButton } from '@/components/CartButton';
import { UserMenu } from '@/components/UserMenu';
import { MobileMenu } from './mobile-menu';
import { WishlistButton } from '@/components/WishlistButton';
import { Category } from '@nest/types';

interface MainHeaderProps {
  categories: Category[];
}

export function MainHeader({ categories }: MainHeaderProps) {
  return (
    <div className="bg-header-main text-header-foreground py-3.5 border-b border-white/10">
      <div className="container-marketplace flex items-center justify-between gap-5">
        <div className="flex items-center shrink-0">
          <MobileMenu categories={categories} />
          {/* `min-h-11`: the mark and the wordmark stack to 40px, and this is a link. */}
          <Link href="/" className="flex min-h-11 items-center gap-2.5 shrink-0 group">
            <div className="relative">
              <div className="w-10 h-10 bg-primary rounded-sm flex items-center justify-center">
                <Cpu className="w-5 h-5 text-primary-foreground" />
              </div>
            </div>
            <div className="flex flex-col">
              <div className="flex items-baseline gap-0.5">
                <span className="font-black text-[25px] tracking-tight text-header-foreground leading-none">nest</span>
                <span className="text-primary font-black text-[25px] leading-none">.</span>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-header-foreground/60 leading-none mt-1">Electronics</span>
            </div>
          </Link>
        </div>

        <div className="flex-1 min-w-[360px] max-w-5xl hidden lg:block">
          <SearchBar categories={categories} />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <WishlistButton />
          <UserMenu />
          <div className="w-px h-7 bg-white/10 mx-1 hidden sm:block" />
          <CartButton />
        </div>
      </div>
    </div>
  );
}
