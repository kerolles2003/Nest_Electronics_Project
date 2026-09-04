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
          {/*
            What this panel used to say: "Sign in to sync your wishlist across
            devices and access it anywhere."

            That is not true and cannot become true by signing in. There is no
            wishlist endpoint; server-side wishlists are Phase 8. Telling a
            customer that an account will carry their saved items, and then
            losing the list the moment they clear their browser, is a promise
            the system has no way to keep.
          */}
          <div className="border rounded-xl bg-card p-6">
            <p className="text-muted-foreground text-center">
              Saved in this browser only. Clearing your browser data clears this
              list, and it will not follow you to another device.
            </p>
          </div>

          <div className="border rounded-xl divide-y">
            {items.map((slug) => (
              <div key={slug} className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-center gap-4">
                  <Heart className="w-5 h-5 shrink-0 text-destructive fill-destructive" />
                  {/*
                    A working link at last. The store used to hold product ids
                    and this linked to `/products/<id>`, which is a 404 —
                    products resolve by slug only. Every row on this page was a
                    dead end.
                  */}
                  <Link
                    href={ROUTES.product(slug)}
                    className="truncate font-medium hover:text-primary transition-colors"
                  >
                    {slug}
                  </Link>
                </div>
                <button
                  onClick={() => removeItem(slug)}
                  className="shrink-0 text-sm text-muted-foreground hover:text-destructive transition-colors"
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
