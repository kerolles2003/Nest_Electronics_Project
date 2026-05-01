"use client"

import { cn } from "./utils"

export interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  className,
}: PaginationProps) {
  const pages = getPageNumbers(currentPage, totalPages)

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className={cn("flex items-center justify-center gap-1 mt-8", className)}
    >
      <button
        type="button"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        className={cn(
          "px-3 h-9 flex items-center justify-center rounded-md text-sm border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors",
          "disabled:opacity-40 disabled:pointer-events-none"
        )}
        aria-label="Previous page"
      >
        Prev
      </button>

      {pages.map((page, i) => {
        if (page === "...") {
          return (
            <span
              key={`ellipsis-${i}`}
              className="flex w-9 h-9 items-center justify-center text-sm text-muted-foreground"
            >
              ...
            </span>
          )
        }

        const p = page as number
        const isActive = p === currentPage

        return (
          <button
            key={p}
            type="button"
            disabled={isActive}
            onClick={() => onPageChange(p)}
            className={cn(
              "w-9 h-9 flex items-center justify-center rounded-md text-sm border transition-colors",
              isActive
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            )}
            aria-label={`Page ${p}`}
            aria-current={isActive ? "page" : undefined}
          >
            {p}
          </button>
        )
      })}

      <button
        type="button"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        className={cn(
          "px-3 h-9 flex items-center justify-center rounded-md text-sm border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors",
          "disabled:opacity-40 disabled:pointer-events-none"
        )}
        aria-label="Next page"
      >
        Next
      </button>
    </nav>
  )
}

function getPageNumbers(
  current: number,
  total: number
): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const pages: (number | "...")[] = [1]

  if (current > 3) {
    pages.push("...")
  }

  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  for (let i = start; i <= end; i++) {
    pages.push(i)
  }

  if (current < total - 2) {
    pages.push("...")
  }

  pages.push(total)

  return pages
}
