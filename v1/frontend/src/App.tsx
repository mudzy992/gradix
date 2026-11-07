import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { queryClient } from '@/lib/query-client'
import { appRoutes } from '@/routes/app-router'
import { Toaster } from '@/components/ui/sonner'

const router = createBrowserRouter(appRoutes)

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  )
}
