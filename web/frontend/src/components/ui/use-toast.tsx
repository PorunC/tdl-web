import { useEffect, useState } from 'react'

interface Toast {
  id: string
  title: string
  description?: string
  variant?: 'default' | 'destructive'
}

let toasts: Toast[] = []
let listeners: (() => void)[] = []

const notify = () => listeners.forEach(listener => listener())

export const toast = ({ title, description, variant = 'default' }: Omit<Toast, 'id'>) => {
  const id = Math.random().toString(36).substr(2, 9)
  toasts.push({ id, title, description, variant })
  notify()
  
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id)
    notify()
  }, 5000)
}

export const useToast = () => {
  const [, forceUpdate] = useState({})
  
  useEffect(() => {
    const listener = () => forceUpdate({})
    listeners.push(listener)
    return () => {
      listeners = listeners.filter(l => l !== listener)
    }
  }, [])

  return {
    toast,
    toasts: [...toasts],
    dismiss: (id: string) => {
      toasts = toasts.filter(t => t.id !== id)
      notify()
    }
  }
}

export const Toaster = () => {
  const { toasts, dismiss } = useToast()

  return (
    <div className="fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all ${
            toast.variant === 'destructive' 
              ? 'border-destructive bg-destructive text-destructive-foreground' 
              : 'border bg-background text-foreground'
          }`}
        >
          <div className="grid gap-1">
            <div className="text-sm font-semibold">{toast.title}</div>
            {toast.description && (
              <div className="text-sm opacity-90">{toast.description}</div>
            )}
          </div>
          <button
            onClick={() => dismiss(toast.id)}
            className="absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}