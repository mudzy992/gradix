import { DiaryEntry, DiaryPhoto, Incident, IncidentPhoto } from '../../../generated/client';
import { dateOnlyIso } from '../../common/scope/company-tz';

export function serializeDiaryPhoto(row: DiaryPhoto) {
  return {
    id: row.id,
    path: row.path,
    caption: row.caption,
    lat: row.lat?.toString() ?? null,
    lng: row.lng?.toString() ?? null,
  };
}

export function serializeDiary(row: DiaryEntry & { photos?: DiaryPhoto[] }) {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId,
    date: dateOnlyIso(row.date),
    weather: row.weather,
    tempMin: row.tempMin?.toString() ?? null,
    tempMax: row.tempMax?.toString() ?? null,
    workDescription: row.workDescription,
    problemsNoted: row.problemsNoted,
    workersCount: row.workersCount,
    pdfUrl: row.pdfUrl,
    isVoiceInput: row.isVoiceInput,
    isSynced: row.isSynced,
    localId: row.localId,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    photos: (row.photos ?? []).map(serializeDiaryPhoto),
  };
}

export function serializeIncident(row: Incident & { photos?: IncidentPhoto[] }) {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId,
    taskId: row.taskId,
    userId: row.userId,
    severity: row.severity,
    description: row.description,
    lat: row.lat?.toString() ?? null,
    lng: row.lng?.toString() ?? null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    photos: (row.photos ?? []).map((photo) => ({ id: photo.id, path: photo.path })),
  };
}
