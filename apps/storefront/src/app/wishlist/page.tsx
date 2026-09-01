'use client';

import React from 'react';
import { Heart, ArrowRight } from 'lucide-react';
import { useWishlistStore } from '@/stores/wishlist-store';
import { Button } from '@nest/ui';
import Link from 'next/link';
import { ROUTES } from '@nest/config/constants';

export default function WishlistPage() {
  const { items, removeItem } = useWishlistStore();

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Heart className="w-8 h-8 text-destructive" />
          My Wishlist
        </h1>
        <p className="text-muted-foreground mt-2">
          {items.length} {items.length === 1 ? 'item' : 'items'} saved
        </p>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 border rounded-xl bg-card">
          <Heart className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          <h2 className="text-xl font-semibold mb-2">Your wishlist is empty</h2>
          <p className="text-muted-foreground mb-6">
            Save your favorite products to keep track of them.
          </p>
          <Link href={ROUTES.products}>
            <Button>
              Browse Products
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="border rounded-xl bg-card p-6">
            <p className="text-muted-foreground text-center">
              Sign in to sync your wishlist across devices and access it anywhere.
            </p>
          </div>

          <div className="border rounded-xl divide-y">
            {items.map((productId) => (
              <div key={productId} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Heart className="w-5 h-5 text-destructive fill-destructive" />
                  <div>
                    <Link
                      href={ROUTES.product(productId)}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      Product #{productId.slice(0, 8)}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      ID: {productId}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => removeItem(productId)}
                  className="text-sm text-muted-foreground hover:text-destructive transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
