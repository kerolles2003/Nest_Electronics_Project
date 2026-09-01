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
export { ToastContext }

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
      <div className="fixed top-4 right-4 z-[9999] space-y-3 w-80 pointer-events-none">
        {toasts.map((toast) => {
          const Icon = iconMap[toast.type]
          return (
            <div
              key={toast.id}
              role="alert"
              style={{
                backgroundColor: 'white',
                color: '#1a1a2e',
                opacity: 1,
                zIndex: 9999,
                pointerEvents: 'auto'
              }}
              className={cn(
                "flex items-start gap-3 border border-border rounded-md shadow-2xl px-4 py-3 border-l-4 transition-all duration-300",
                borderColorMap[toast.type]
              )}
            >
              <Icon className={cn("w-5 h-5 shrink-0 mt-0.5", iconColorMap[toast.type])} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: 'inherit' }}>
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
    // Return a dummy object on the server to prevent SSR crashes
    // On the client, we still want to warn/error if the provider is missing
    if (typeof window === "undefined") {
      return {
        addToast: () => {},
        removeToast: () => {},
      }
    }
    throw new Error("useToast must be used within a ToastProvider")
  }
  return ctx
}
