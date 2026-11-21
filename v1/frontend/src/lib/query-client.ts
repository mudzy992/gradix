import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api-types'

/**
 * FE-15: `retry: 1` je ponavljao **svaku** grešku, pa i `403`/`404`/`429`. Ponavljanje odbijenog
 * zahtjeva ne mijenja ishod, a kod throttlera (429) ga još pogoršava — svaki retry je novi zahtjev u
 * istom prozoru. Sada se ponavljaju samo prolazne greške: mreža (`NETWORK_ERROR`) i 5xx.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    const transient = error.code === 'NETWORK_ERROR' || error.status >= 500
    return transient && failureCount < 1
  }
  return failureCount < 1
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      refetchOnWindowFocus: false,
    },
  },
})
