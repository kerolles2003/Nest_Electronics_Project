'use client';

import React from 'react';
import { Heart } from 'lucide-react';
import { useWishlistStore } from '@/stores/wishlist-store';
import Link from 'next/link';
import { ROUTES } from '@nest/config/constants';

export function WishlistButton() {
  const [mounted, setMounted] = React.useState(false);
  const items = useWishlistStore((state) => state.items);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const count = mounted ? items.length : 0;

  return (
    <Link href={ROUTES.wishlist} className="nav-icon-btn relative group hidden sm:flex" aria-label={`Wishlist, ${count} items`}>
      <Heart className="w-5 h-5" strokeWidth={1.7} />
      {count > 0 && (
        <span className="navbar-badge">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
