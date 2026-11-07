import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Dialog } from '@/components/ui/dialog'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { queryClient } from '@/lib/query-client'
import { readCompanyId, writeCompanyId } from '@/lib/storage'
import { useCompanyStore } from '@/stores/company-store'

beforeEach(() => {
  queryClient.clear()
  useCompanyStore.setState({ selectedId: 'a', revision: 9 })
  writeCompanyId('a')
  queryClient.setQueryData(['sensitive'], 'A')
})
afterEach(() => { queryClient.clear(); writeCompanyId(null) })

describe('company switch protection', () => {
  it('preserves the draft, storage, revision and cache while a controlled sheet is open', async () => {
    const { rerender } = render(<Sheet open><SheetContent><SheetTitle>Form</SheetTitle><input aria-label="Draft" defaultValue="original" /></SheetContent></Sheet>)
    await userEvent.clear(screen.getByLabelText('Draft'))
    await userEvent.type(screen.getByLabelText('Draft'), 'unsaved')
    expect(useCompanyStore.getState().setSelectedId('a')).toBe(true)
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(false)
    expect(screen.getByLabelText('Draft')).toHaveValue('unsaved')
    expect(readCompanyId()).toBe('a')
    expect(useCompanyStore.getState()).toMatchObject({ selectedId: 'a', revision: 9 })
    expect(queryClient.getQueryData(['sensitive'])).toBe('A')
    rerender(<Sheet open={false}><SheetContent><SheetTitle>Form</SheetTitle></SheetContent></Sheet>)
    act(() => { expect(useCompanyStore.getState().setSelectedId('b')).toBe(true) })
    expect(readCompanyId()).toBe('b')
    expect(queryClient.getQueryData(['sensitive'])).toBeUndefined()
  })

  it('retains independent locks for multiple overlays and releases them on unmount', () => {
    const { rerender, unmount } = render(<><Sheet open /><Dialog open /><AlertDialog open /></>)
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(false)
    rerender(<><Sheet open={false} /><Dialog open /><AlertDialog open={false} /></>)
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(false)
    unmount()
    act(() => { expect(useCompanyStore.getState().setSelectedId('b')).toBe(true) })
  })

  it('tracks uncontrolled open and close via the Radix trigger', async () => {
    render(<Sheet><SheetTrigger>Open</SheetTrigger><SheetContent><SheetTitle>Form</SheetTitle></SheetContent></Sheet>)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(useCompanyStore.getState().setSelectedId('b')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Zatvori' }))
    act(() => { expect(useCompanyStore.getState().setSelectedId('b')).toBe(true) })
  })

  it('allows the navigation sheet to switch companies without bypassing other locks', () => {
    const { rerender } = render(<Sheet open allowCompanySwitch />)
    act(() => { expect(useCompanyStore.getState().setSelectedId('b')).toBe(true) })
    rerender(<><Sheet open allowCompanySwitch /><AlertDialog open /></>)
    expect(useCompanyStore.getState().setSelectedId('a')).toBe(false)
  })
})
