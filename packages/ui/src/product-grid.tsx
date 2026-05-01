import * as React from "react"
import { cn } from "./utils"

export interface ProductGridProps {
  children: React.ReactNode
  className?: string
}

export function ProductGrid({ children, className }: ProductGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4",
        className
      )}
    >
      {children}
    </div>
  )
}
