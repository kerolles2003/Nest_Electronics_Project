'use client';

import * as React from "react";
import { Menu, X, ChevronRight, ChevronDown } from "lucide-react";
import { MAIN_NAV_LINKS } from '@nest/config/constants';
import { Category } from '@nest/types';
import Link from 'next/link';
import { SearchBar } from './search-bar';
import { cn } from '@nest/ui';

interface MobileMenuProps {
  categories: Category[];
}

export function MobileMenu({ categories }: MobileMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'menu' | 'categories'>('menu');
  const [expandedCategories, setExpandedCategories] = React.useState<Record<string, boolean>>({});

  // prevent body scroll when open
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  /*
   * Escape closes it.
   *
   * There was no keyboard way out at all: the drawer covers the page, the
   * overlay only responds to a click, and nothing listened for a key. On a
   * phone that is invisible; with a keyboard it is a dead end.
   */
  React.useEffect(() => {
    if (!isOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [isOpen]);

  const toggleCategory = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedCategories(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const rootCategories = categories.filter(c => !c.parent_id);

  const renderCategory = (category: Category, level = 0) => {
    const hasChildren = categories.some(c => c.parent_id === category.id);
    const isExpanded = expandedCategories[category.id];

    return (
      <div key={category.id} className="flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-100 last:border-0">
          <Link
            href={`/categories/${category.slug}`}
            className={cn(
              "flex-1 px-4 py-3 text-sm font-medium text-foreground hover:text-primary transition-colors",
              level > 0 && "pl-8 text-xs opacity-80"
            )}
            onClick={() => setIsOpen(false)}
          >
            {category.name_en}
          </Link>
          {hasChildren && (
            <button
              onClick={(e) => toggleCategory(category.id, e)}
              className="p-3 text-foreground-muted hover:text-foreground transition-colors border-l border-gray-100"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div className="bg-gray-50/50">
            {categories
              .filter(c => c.parent_id === category.id)
              .map(child => renderCategory(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex h-11 w-11 -ml-2 mr-1 items-center justify-center text-current hover:text-primary transition-colors lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Drawer */}
      {/*
        `inert` while closed, which is the whole fix.

        The drawer is always in the DOM and merely translated off-screen, so its
        eleven links and buttons stayed in the tab order on EVERY page: a
        keyboard user tabbing off the logo fell into an invisible menu, and a
        screen reader announced a navigation that was not on screen. `inert`
        removes it from both the tab order and the accessibility tree in one
        attribute — `aria-hidden` alone would have fixed only the second half
        and left the focus trap.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        inert={!isOpen}
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-[300px] bg-background border-r border-border shadow-xl transform transition-transform duration-300 ease-in-out lg:hidden flex flex-col",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <span className="font-heading font-bold text-lg uppercase tracking-wider text-foreground">Menu</span>
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close menu"
            className="flex h-11 w-11 -mr-2 items-center justify-center text-foreground-muted hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            className={cn(
              "flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors",
              activeTab === 'menu' ? "border-primary text-primary" : "border-transparent text-foreground-muted"
            )}
            onClick={() => setActiveTab('menu')}
          >
            Menu
          </button>
          <button
            className={cn(
              "flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors",
              activeTab === 'categories' ? "border-primary text-primary" : "border-transparent text-foreground-muted"
            )}
            onClick={() => setActiveTab('categories')}
          >
            Categories
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {activeTab === 'menu' ? (
            <div className="py-2">
               <div className="px-4 py-4 mb-2">
                <SearchBar categories={categories} />
              </div>
              <nav className="flex flex-col">
                {MAIN_NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="px-4 py-3 text-[14px] font-bold text-foreground uppercase tracking-wider hover:text-primary hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                    onClick={() => setIsOpen(false)}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
          ) : (
            <div className="flex flex-col">
              {rootCategories.map(cat => renderCategory(cat))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
