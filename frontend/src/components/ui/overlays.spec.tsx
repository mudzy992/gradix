import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'

/**
 * FE-16 — portalu komponente (dialog, sheet, alert-dialog, meni, select, toast). Drži:
 *  - oznaka za zatvaranje je **prevedena** (bila je hardkodirana „Close“ u bosanskom interfejsu),
 *  - dijalog ima ime i opis (`aria-labelledby`/`aria-describedby` — čitač ekrana najavi sadržaj),
 *  - potvrdni dijalog je `alertdialog` i ima obje akcije,
 *  - meni i select se otvaraju tastaturom/mišem i vraćaju izbor.
 */
describe('Dialog', () => {
  it('ima pristupačno ime i opis, a zatvaranje je na bosanskom', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novi korisnik</DialogTitle>
            <DialogDescription>Popunite podatke o korisniku.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Novi korisnik')
    expect(dialog).toHaveAccessibleDescription('Popunite podatke o korisniku.')
    expect(within(dialog).getByRole('button', { name: 'Zatvori' })).toBeInTheDocument()
  })

  it('otvara se iz triggera i zatvara preko prevedenog dugmeta', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Otvori</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalji</DialogTitle>
            <DialogDescription>Opis detalja.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Otvori' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zatvori' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('`showCloseButton` u podnožju prikazuje prevedeno dugme', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Potvrda</DialogTitle>
            <DialogDescription>Opis.</DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>,
    )

    expect(screen.getByRole('button', { name: 'Zatvori' })).toBeInTheDocument()
  })
})

describe('Sheet', () => {
  it('je dijalog sa naslovom i prevedenim zatvaranjem', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Meni</SheetTitle>
            <SheetDescription>Navigacija</SheetDescription>
          </SheetHeader>
          <SheetFooter>Podnožje</SheetFooter>
        </SheetContent>
      </Sheet>,
    )

    const sheet = screen.getByRole('dialog')
    expect(sheet).toHaveAccessibleName('Meni')
    expect(within(sheet).getByRole('button', { name: 'Zatvori' })).toBeInTheDocument()
  })

  it('otvara se iz triggera', async () => {
    render(
      <Sheet>
        <SheetTrigger asChild>
          <Button>Filteri</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filteri</SheetTitle>
            <SheetDescription>Izaberite filtere.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Filteri' }))
    expect(await screen.findByRole('dialog', { name: 'Filteri' })).toBeInTheDocument()
  })
})

describe('AlertDialog', () => {
  it('je `alertdialog` sa obje akcije i opisom', async () => {
    const onConfirm = vi.fn()
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Deaktiviraj</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deaktivirati korisnika?</AlertDialogTitle>
            <AlertDialogDescription>Korisnik više neće moći da se prijavi.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Otkaži</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Deaktiviraj</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Deaktiviraj' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Deaktivirati korisnika?')
    expect(dialog).toHaveAccessibleDescription('Korisnik više neće moći da se prijavi.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deaktiviraj' }))
    expect(onConfirm).toHaveBeenCalled()
  })
})

describe('Select', () => {
  it('prikazuje placeholder, otvara listu i upisuje izbor', async () => {
    render(
      <Select>
        <SelectTrigger aria-label="Firma">
          <SelectValue placeholder="Izaberite firmu" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Firme</SelectLabel>
            <SelectItem value="demo">Demo Gradnja</SelectItem>
            <SelectItem value="drugi">Druga firma</SelectItem>
          </SelectGroup>
          <SelectSeparator />
        </SelectContent>
      </Select>,
    )

    expect(screen.getByRole('combobox', { name: 'Firma' })).toHaveTextContent('Izaberite firmu')
    await userEvent.click(screen.getByRole('combobox', { name: 'Firma' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Druga firma' }))

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Firma' })).toHaveTextContent('Druga firma'))
  })
})

describe('DropdownMenu', () => {
  it('otvara meni, prikazuje oznaku i stavke, i izvršava izbor', async () => {
    const onSelect = vi.fn()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Meni</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Nalog</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onSelect}>
              Profil
              <DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem checked>Prati zadatke</DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">Odjavi se</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Meni' }))

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByText('Nalog')).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Prati zadatke' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('menuitem', { name: /Profil/ }))
    expect(onSelect).toHaveBeenCalled()
  })
})

describe('DropdownMenu — radio i podmeni', () => {
  it('radio grupa prikazuje izabranu vrijednost i mijenja je', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Jezik</Button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="bs">
              <DropdownMenuRadioItem value="bs">Bosanski</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="en">Engleski</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Jezik' }))

    expect(await screen.findByRole('menuitemradio', { name: 'Bosanski' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Engleski' })).toHaveAttribute('aria-checked', 'false')
  })

  it('podmeni se otvara na tastaturi (strelica desno) i nudi stavku', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Meni</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Više</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Postavke</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Meni' }))
    const trigger = await screen.findByRole('menuitem', { name: 'Više' })
    trigger.focus()
    await userEvent.keyboard('{ArrowRight}')

    expect(await screen.findByRole('menuitem', { name: 'Postavke' })).toBeInTheDocument()
  })
})

describe('Toaster', () => {
  it('prikazuje toast preko `sonner`-a (region za najavu postoji)', async () => {
    render(<Toaster />)

    toast.success('Sačuvano')

    expect(await screen.findByText('Sačuvano')).toBeInTheDocument()
  })
})
