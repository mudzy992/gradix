import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/query-client'
import { useCompanyStore } from '@/stores/company-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const load = vi.fn<() => Promise<string>>()
function Probe() {
  const query = useQuery({ queryKey: ['tenant-data'], queryFn: load, retry: false })
  return <div>{query.isLoading ? 'Učitavanje' : query.isError ? 'Greška' : query.data}</div>
}
function mount() {
  return render(<QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>)
}
beforeEach(() => {
  queryClient.clear()
  load.mockReset()
  useCompanyStore.setState({ selectedId: 'a' })
})
afterEach(() => queryClient.clear())

describe('tenant query cache on company switch', () => {
  it('odmah sakriva aktivne i neaktivne podatke firme A, čak i ako B padne', async () => {
    const b = deferred<string>()
    load.mockResolvedValueOnce('A povjerljivo').mockReturnValueOnce(b.promise)
    queryClient.setQueryData(['inactive-list'], ['A tajno'])
    const recovery = { idempotencyKey: 'key-a', inFlight: false, reference: { path: 'a/file', fileName: 'plan.pdf' } }
    queryClient.setQueryData(['project-document-pending', 'scope-a'], recovery)
    const movement = { operation: { idempotencyKey: 'movement-a' }, inFlight: true, attempt: 1 }
    queryClient.setQueryData(['stock-movement-pending', 'scope-a'], movement)
    mount()
    expect(await screen.findByText('A povjerljivo')).toBeInTheDocument()
    act(() => useCompanyStore.getState().setSelectedId('b'))
    expect(queryClient.getQueryData(['inactive-list'])).toBeUndefined()
    expect(queryClient.getQueryData(['project-document-pending', 'scope-a'])).toEqual(recovery)
    expect(queryClient.getQueryData(['stock-movement-pending', 'scope-a'])).toEqual(movement)
    await waitFor(() => expect(screen.queryByText('A povjerljivo')).not.toBeInTheDocument())
    expect(screen.getByText('Učitavanje')).toBeInTheDocument()
    await act(async () => b.reject(new Error('offline')))
    expect(await screen.findByText('Greška')).toBeInTheDocument()
    expect(screen.queryByText('A povjerljivo')).not.toBeInTheDocument()
  })

  it('zakašnjeli rezultat A ne vraća podatke u B i povratak na A ponovo ih učita', async () => {
    const old = deferred<string>()
    const b = deferred<string>()
    load.mockReturnValueOnce(old.promise).mockReturnValueOnce(b.promise).mockResolvedValueOnce('A svježe')
    mount()
    await waitFor(() => expect(load).toHaveBeenCalledOnce())
    act(() => useCompanyStore.getState().setSelectedId('b'))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    await act(async () => old.resolve('A staro'))
    expect(screen.queryByText('A staro')).not.toBeInTheDocument()
    await act(async () => b.resolve('B podaci'))
    expect(await screen.findByText('B podaci')).toBeInTheDocument()
    act(() => useCompanyStore.getState().setSelectedId('a'))
    await waitFor(() => expect(screen.queryByText('B podaci')).not.toBeInTheDocument())
    expect(await screen.findByText('A svježe')).toBeInTheDocument()
  })

  it('izbor iste firme ne briše podatke niti pokreće novi zahtjev', async () => {
    load.mockResolvedValue('A podaci')
    mount()
    expect(await screen.findByText('A podaci')).toBeInTheDocument()
    const initial = useCompanyStore.getState().revision
    act(() => useCompanyStore.getState().setSelectedId('a'))
    expect(useCompanyStore.getState().revision).toBe(initial)
    expect(screen.getByText('A podaci')).toBeInTheDocument()
    expect(load).toHaveBeenCalledOnce()
  })
})
