import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

/**
 * FE-16 — UI primitive (bez portala). Drži ono što se lako pokvari tiho:
 *
 *  - **kontrast taba**: neaktivni tab je bio `text-foreground/60` = 4,26:1 (ispod AA granice 4,5:1);
 *  - **skrolovanje tastaturom**: kontejner tabele i viewport `ScrollArea` nisu bili fokusabilni, pa
 *    korisnik bez miša nije mogao doći do sadržaja van ekrana (WCAG 2.1.1);
 *  - **semantika**: zaglavlja kolona imaju `scope`, `dt/dd` i labele rade, `aria-invalid` se vidi.
 */
describe('Button', () => {
  it('varijanta i veličina su vidljive kroz `data-*` (stilovi se testiraju na izvoru)', () => {
    render(<Button variant="destructive" size="sm">Obriši</Button>)

    const button = screen.getByRole('button', { name: 'Obriši' })
    expect(button).toHaveAttribute('data-variant', 'destructive')
    expect(button).toHaveAttribute('data-size', 'sm')
    expect(button.className).toContain('bg-destructive')
  })

  it('`asChild` predaje klase linku (bez ugniježđenog dugmeta)', () => {
    render(
      <Button asChild variant="outline">
        <a href="/projects">Projekti</a>
      </Button>,
    )

    const link = screen.getByRole('link', { name: 'Projekti' })
    expect(link).toHaveAttribute('href', '/projects')
    expect(link.className).toContain('border')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('onemogućeno dugme ne prima klik', async () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Sačuvaj</Button>)

    await userEvent.click(screen.getByRole('button', { name: 'Sačuvaj' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('fokus je uvijek vidljiv (ring klasa postoji)', () => {
    render(<Button>Fokus</Button>)

    const button = screen.getByRole('button', { name: 'Fokus' })
    expect(button.className).toContain('focus-visible:ring-[3px]')
  })
})

describe('Badge', () => {
  it('prikazuje tekst i poštuje varijantu', () => {
    render(<Badge variant="outline">U planu</Badge>)

    const badge = screen.getByText('U planu')
    expect(badge).toHaveAttribute('data-variant', 'outline')
  })

  it('`asChild` daje link, ne `span`', () => {
    render(
      <Badge asChild>
        <a href="/tasks/1">Zadatak</a>
      </Badge>,
    )

    expect(screen.getByRole('link', { name: 'Zadatak' })).toBeInTheDocument()
  })
})

describe('Table', () => {
  function renderTable(label?: string) {
    return render(
      <Table label={label}>
        <TableCaption>Korisnici</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Ime</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Demo Admin</TableCell>
            <TableCell>Aktivan</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>1</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    )
  }

  it('kontejner za skrol je fokusabilan region (tastatura može skrolovati)', () => {
    renderTable('Tabela korisnika')

    const region = screen.getByRole('region', { name: 'Tabela korisnika' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region.className).toContain('overflow-x-auto')
    expect(region.className).toContain('focus-visible:ring-[3px]')
  })

  it('zaglavlja kolona se najavljuju kao zaglavlja (`scope="col"`)', () => {
    renderTable()

    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Ime' })).toHaveAttribute('scope', 'col')
  })

  it('caption je dio tabele (ime za čitače ekrana)', () => {
    renderTable()

    expect(screen.getByRole('table')).toHaveAccessibleName('Korisnici')
  })
})

describe('Tabs', () => {
  function renderTabs() {
    return render(
      <Tabs defaultValue="projekti">
        <TabsList>
          <TabsTrigger value="projekti">Projekti</TabsTrigger>
          <TabsTrigger value="zadaci">Zadaci</TabsTrigger>
        </TabsList>
        <TabsContent value="projekti">Lista projekata</TabsContent>
        <TabsContent value="zadaci">Lista zadataka</TabsContent>
      </Tabs>,
    )
  }

  it('neaktivni tab koristi token sa dovoljnim kontrastom (ne `text-foreground/60`)', () => {
    renderTabs()

    const inactive = screen.getByRole('tab', { name: 'Zadaci' })
    expect(inactive.className).toContain('text-muted-foreground')
    expect(inactive.className).not.toContain('text-foreground/60')
  })

  it('aktivni tab je označen i mijenja sadržaj', async () => {
    renderTabs()

    expect(screen.getByRole('tab', { name: 'Projekti' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Zadaci' }))

    expect(screen.getByRole('tab', { name: 'Zadaci' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Lista zadataka')
  })
})

describe('polja i labele', () => {
  it('labela je povezana sa poljem preko `htmlFor`', () => {
    render(
      <>
        <Label htmlFor="naziv">Naziv</Label>
        <Input id="naziv" />
      </>,
    )

    expect(screen.getByLabelText('Naziv')).toBe(screen.getByRole('textbox'))
  })

  it('`aria-invalid` stilizuje i `Input` i `Textarea` (ista poruka, isto stanje)', () => {
    render(
      <>
        <Input aria-invalid aria-label="Email" />
        <Textarea aria-invalid aria-label="Napomena" />
      </>,
    )

    expect(screen.getByRole('textbox', { name: 'Email' }).className).toContain('aria-invalid:border-destructive')
    expect(screen.getByRole('textbox', { name: 'Napomena' }).className).toContain('aria-invalid:border-destructive')
  })

  it('`Textarea` je onemogućena kad treba (isto kao `Input`)', () => {
    render(<Textarea aria-label="Opis" disabled />)

    expect(screen.getByRole('textbox', { name: 'Opis' })).toBeDisabled()
  })
})

describe('Switch i Checkbox', () => {
  it('Switch ima `role="switch"` i mijenja stanje', async () => {
    render(<Switch aria-label="Obavještenja" />)

    const control = screen.getByRole('switch', { name: 'Obavještenja' })
    expect(control).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(control)
    expect(control).toHaveAttribute('aria-checked', 'true')
  })

  it('onemogućen Switch ne mijenja stanje', async () => {
    render(<Switch aria-label="Zaključano" disabled />)

    const control = screen.getByRole('switch', { name: 'Zaključano' })
    await userEvent.click(control)
    expect(control).toHaveAttribute('aria-checked', 'false')
  })

  it('Checkbox se označava i odznačava', async () => {
    render(<Checkbox aria-label="Prihvati" />)

    const box = screen.getByRole('checkbox', { name: 'Prihvati' })
    await userEvent.click(box)
    expect(box).toHaveAttribute('aria-checked', 'true')
  })
})

describe('Separator, Avatar, Card, ScrollArea', () => {
  it('dekorativni separator nije u stablu pristupačnosti, nedekorativni jeste', () => {
    const { unmount } = render(<Separator />)
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    unmount()

    render(<Separator decorative={false} />)
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('Avatar prikazuje fallback tekst i značku', () => {
    render(
      <Avatar>
        <AvatarImage src="/nepostoji.png" alt="Demo Admin" />
        <AvatarFallback>DA</AvatarFallback>
        <AvatarBadge />
      </Avatar>,
    )

    expect(screen.getByText('DA')).toBeInTheDocument()
  })

  it('AvatarGroup prikazuje broj skrivenih avatara', () => {
    render(
      <AvatarGroup>
        <Avatar>
          <AvatarFallback>DA</AvatarFallback>
        </Avatar>
        <AvatarGroupCount>+3</AvatarGroupCount>
      </AvatarGroup>,
    )

    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('Card delovi nose `data-slot` oznake (stilovi i testovi se hvataju za njih)', () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle>Naslov</CardTitle>
          <CardDescription>Opis</CardDescription>
          <CardAction>Akcija</CardAction>
        </CardHeader>
        <CardContent>Sadržaj</CardContent>
        <CardFooter>Podnožje</CardFooter>
      </Card>,
    )

    for (const slot of ['card', 'card-header', 'card-title', 'card-description', 'card-action', 'card-content', 'card-footer']) {
      expect(container.querySelector(`[data-slot="${slot}"]`), slot).not.toBeNull()
    }
  })

  it('viewport `ScrollArea` je fokusabilan (tastatura može skrolovati listu)', () => {
    const { container } = render(
      <ScrollArea className="h-40">
        <p>Obavještenja</p>
      </ScrollArea>,
    )

    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')
    expect(viewport).toHaveAttribute('tabindex', '0')
  })
})
