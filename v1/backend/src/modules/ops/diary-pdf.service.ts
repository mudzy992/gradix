import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts } from 'pdf-lib';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { requireCompany } from '../users/users-helpers';
import { ProjectAccessService } from './project-access.service';
import { serializeDiary } from './serialize-diary';
import { assertDiaryRead, diaryProjectWhere } from './diary-access';
import { toWinAnsi, wrapLines } from './diary-pdf-text';

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = 60;

@Injectable()
export class DiaryPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
  ) {}

  async generate(actor: AuthUser, id: string) {
    // BE-11 (F-01): ruta je ranije tražila samo vidljiv projekat, ne i `diary.read`
    // — korisnik sa pristupom projektu (npr. radnik) mogao je da izvuče PDF dnevnika.
    assertDiaryRead(actor);
    const companyId = requireCompany(actor);
    const row = await this.prisma.diaryEntry.findFirst({
      where: { id, companyId, ...diaryProjectWhere(actor) },
      include: { photos: true, project: true },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Diary entry not found', 404);
    }
    // Zadržano: projektni pristup (SS/PM) mora biti vidljiv; `diaryProjectWhere`
    // pokriva dnevnik, ovo pokriva i slučaj kada se pravila raziđu.
    await this.access.getVisibleProject(actor, row.projectId);

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    // BE-11 (F-02): tekst se više ne siječe na 110 znakova i ne gubi prelome redova;
    // lomi se po stvarnoj širini fonta, uz nove stranice kad ponestane prostora.
    const draw = (text: string, size = 11, useBold = false): void => {
      const activeFont: PDFFont = useBold ? bold : font;
      const safe = toWinAnsi(text);
      for (const line of wrapLines(safe, CONTENT_WIDTH, (value) =>
        activeFont.widthOfTextAtSize(value, size),
      )) {
        if (y < BOTTOM_LIMIT) {
          page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          y = PAGE_HEIGHT - MARGIN;
        }
        page.drawText(line, { x: MARGIN, y, size, font: activeFont });
        y -= size + 6;
      }
    };
    const blank = (height = 8): void => {
      y -= height;
    };

    draw('Gradix — site diary (internal)', 14, true);
    draw('Not a legal form. Internal copy only.', 9);
    blank();
    draw(`Project: ${row.project.name}`);
    draw(`Date: ${row.date.toISOString().slice(0, 10)}`);
    draw(`Weather: ${row.weather ?? '—'}`);
    draw(`Temperature: ${this.tempText(row.tempMin, row.tempMax)}`);
    draw(`Workers: ${row.workersCount ?? '—'}`);
    blank();
    draw('Work:', 11, true);
    draw(row.workDescription ?? '—');
    blank();
    draw('Problems:', 11, true);
    draw(row.problemsNoted ?? '—');
    blank();
    draw(`Photos: ${row.photos.length}`);
    for (const [index, photo] of row.photos.entries()) {
      draw(
        `${index + 1}. ${photo.caption ? `${photo.caption} — ` : ''}${photo.path}`,
        9,
      );
    }

    const bytes = await pdf.save();
    const path = await this.files.putGenerated(
      row.companyId,
      Buffer.from(bytes),
      'pdf',
      'application/pdf',
    );
    const updated = await this.prisma.diaryEntry.update({
      where: { id },
      data: { pdfUrl: path },
      include: { photos: true },
    });
    await this.audit.write({
      companyId: updated.companyId,
      actorId: actor.id,
      action: 'DIARY_PDF_GENERATED',
      entityType: 'DiaryEntry',
      entityId: updated.id,
      payload: { path, photos: row.photos.length },
    });
    return serializeDiary(updated);
  }

  private tempText(
    min: { toString(): string } | null,
    max: { toString(): string } | null,
  ): string {
    if (!min && !max) {
      return '—';
    }
    return `${min?.toString() ?? '—'} / ${max?.toString() ?? '—'} °C`;
  }
}
