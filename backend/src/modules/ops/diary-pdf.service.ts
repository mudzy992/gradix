import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { ProjectAccessService } from './project-access.service';
import { serializeDiary } from './serialize-diary';

@Injectable()
export class DiaryPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly access: ProjectAccessService,
  ) {}

  async generate(actor: AuthUser, id: string) {
    const row = await this.prisma.diaryEntry.findFirst({
      where: { id },
      include: { photos: true, project: true },
    });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Diary entry not found', 404);
    }
    await this.access.getVisibleProject(actor, row.projectId);
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let y = 800;
    const line = (text: string, size = 11, useBold = false): void => {
      page.drawText(text.slice(0, 110), {
        x: 48,
        y,
        size,
        font: useBold ? bold : font,
      });
      y -= size + 8;
    };
    line('Gradix — site diary (internal)', 14, true);
    line('Not a legal form. Internal copy only.', 9);
    y -= 8;
    line(`Project: ${row.project.name}`);
    line(`Date: ${row.date.toISOString().slice(0, 10)}`);
    line(`Weather: ${row.weather ?? '—'}`);
    line(`Workers: ${row.workersCount ?? '—'}`);
    line(`Work: ${row.workDescription ?? '—'}`);
    line(`Problems: ${row.problemsNoted ?? '—'}`);
    line(`Photos: ${row.photos.length}`);
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
    return serializeDiary(updated);
  }
}
