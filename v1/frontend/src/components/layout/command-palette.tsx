import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { NAV_ITEMS, isNavItemVisible } from '@/components/layout/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'

/** Navigation uses the same permissions and tenant readiness as the sidebar and route guards. */
export function CommandPalette() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const tenantReady = useTenantReady()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const listId = useId()
  const normalize = (value: string) => value.toLocaleLowerCase(i18n.language).normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const options = user ? NAV_ITEMS.filter((item) => isNavItemVisible(item, user) && (!item.tenant || tenantReady))
    .map((item) => ({ ...item, label: t(item.labelKey) }))
    .filter((item) => normalize(item.label).includes(normalize(query.trim()))) : []
  const selected = options[Math.min(index, options.length - 1)]
  const selectedIndex = selected ? options.indexOf(selected) : -1

  useEffect(() => {
    if (open && selectedIndex >= 0) document.getElementById(`${listId}-${selectedIndex}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, selectedIndex, listId])
  function setVisible(next: boolean) {
    if (next) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setQuery('')
      setIndex(0)
    }
    setOpen(next)
  }
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return
      // Do not stack navigation over a protected draft or another modal.
      if (!open && document.querySelector('[role="dialog"][data-state="open"]')) return
      event.preventDefault()
      setVisible(!open)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [open])
  function choose(path: string) { setOpen(false); navigate(path) }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && options.length) { event.preventDefault(); setIndex((selectedIndex + 1) % options.length) }
    if (event.key === 'ArrowUp' && options.length) { event.preventDefault(); setIndex((selectedIndex - 1 + options.length) % options.length) }
    if (event.key === 'Enter' && selected) { event.preventDefault(); choose(selected.to) }
  }

  return <Dialog open={open} onOpenChange={setVisible}>
    <DialogTrigger asChild><Button variant="ghost" size="sm" aria-label={t('commandPalette.open')} className="text-muted-foreground"><Search aria-hidden="true" /><span className="hidden sm:inline">{t('commandPalette.title')}</span><kbd aria-hidden="true" className="hidden rounded border px-1 text-xs sm:inline">Ctrl / ⌘ K</kbd></Button></DialogTrigger>
    <DialogContent className="gap-0 p-0" onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus() }} onCloseAutoFocus={(event) => {
      if (previousFocus.current?.isConnected) { event.preventDefault(); previousFocus.current.focus() }
    }}>
      <DialogTitle className="sr-only">{t('commandPalette.title')}</DialogTitle>
      <DialogDescription className="sr-only">{t('commandPalette.description')}</DialogDescription>
      <div className="flex items-center gap-3 border-b px-4 pr-12"><Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><input ref={inputRef} role="combobox" aria-label={t('commandPalette.search')} aria-expanded="true" aria-controls={listId} aria-activedescendant={selected ? `${listId}-${selectedIndex}` : undefined} aria-autocomplete="list" autoComplete="off" placeholder={t('commandPalette.placeholder')} value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0) }} onKeyDown={onKeyDown} className="h-14 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></div>
      <div className="max-h-80 overflow-y-auto p-2"><div id={listId} role="listbox" aria-label={t('commandPalette.title')}>{options.map((item, optionIndex) => { const Icon = item.icon; return <button key={item.to} id={`${listId}-${optionIndex}`} type="button" role="option" aria-selected={optionIndex === selectedIndex} onMouseMove={() => setIndex(optionIndex)} onClick={() => choose(item.to)} className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', optionIndex === selectedIndex && 'bg-secondary text-secondary-foreground')}><Icon className="size-4" aria-hidden="true" />{item.label}</button> })}</div>{options.length === 0 && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{t('commandPalette.empty')}</p>}</div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">{t('commandPalette.hint')}</p>
    </DialogContent>
  </Dialog>
}
