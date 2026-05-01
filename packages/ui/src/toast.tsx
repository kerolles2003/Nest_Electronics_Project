"use client"

import * as React from "react"
import { CheckCircle, XCircle, Info, X } from "lucide-react"
import { cn } from "./utils"

export interface Toast {
  id: string
  title: string
  message?: string
  type: "success" | "error" | "info"
}

interface ToastContextValue {
  addToast: (title: string, type: Toast["type"], message?: string) => void
  removeToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const iconMap: Record<Toast["type"], React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
}

const iconColorMap: Record<Toast["type"], string> = {
  success: "text-success",
  error: "text-destructive",
  info: "text-primary",
}

const defaultTitleMap: Record<Toast["type"], string> = {
  success: "Success",
  error: "Error",
  info: "Info",
}

const borderColorMap: Record<Toast["type"], string> = {
  success: "border-l-success",
  error: "border-l-destructive",
  info: "border-l-primary",
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const addToast = React.useCallback(
    (title: string, type: Toast["type"], message?: string) => {
      const id = crypto.randomUUID()
      setToasts((prev) => [...prev, { id, title, message, type }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 4000)
    },
    []
  )

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2 w-80">
        {toasts.map((toast) => {
          const Icon = iconMap[toast.type]
          return (
            <div
              key={toast.id}
              role="alert"
              className={cn(
                "flex items-start gap-3 bg-card border border-border rounded-md shadow-lg px-4 py-3 border-l-4",
                borderColorMap[toast.type]
              )}
            >
              <Icon className={cn("w-5 h-5 shrink-0 mt-0.5", iconColorMap[toast.type])} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {toast.title ?? defaultTitleMap[toast.type]}
                </p>
                {toast.message && (
                  <p className="text-xs text-muted-foreground mt-0.5">{toast.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return ctx
}
