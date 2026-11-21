export type DashboardCard = { key: string; value: string | number | null }

export type PresencePerson = {
  userId: string
  firstName: string
  lastName: string
  lastSeenAt: string
  projectId: string
}

export type DashboardPayload = {
  cards: DashboardCard[]
  presence: PresencePerson[] | null
  expiring?: { entityType: string; entityId: string; type: string; daysLeft: number }[]
}

export type ProjectRow = {
  id: string
  code: string | null
  name: string
  status: string
  locality: string | null
  lat: string | null
  lng: string | null
  geofenceRadius: number
  progressPercent: number
  plannedBudget?: string | null
  currentSpend?: string
  client?: string | null
  plannedStart: string | null
  plannedEnd: string | null
  archivedAt: string | null
  isPublic?: boolean
  coverAssetId?: string | null
}

export type PhaseRow = {
  id: string
  name: string
  sortOrder: number
  plannedStart: string | null
  plannedEnd: string | null
  progressPercent: number
}

export type AssignmentRow = {
  id: string
  userId: string
  role: string
  user?: { id: string; firstName: string; lastName: string }
}

export type DocumentRow = { id: string; path: string; fileName: string }

export type QuantityRow = {
  id: string
  phaseId: string | null
  name: string
  unit: string
  plannedQty: string
  executedQty: string
  note: string | null
}

export type TaskRow = {
  id: string
  projectId: string
  phaseId: string | null
  title: string
  description: string | null
  priority: string
  status: string
  plannedStart: string | null
  plannedEnd: string | null
  totalTimeSpentMinutes: number
  assigneeIds?: string[]
}

export type TimerMe = {
  session: { id: string; taskId: string; pausedAt: string | null; startedAt: string } | null
  elapsedMinutes: number
}

export type DiaryPhoto = { id: string; path: string; caption: string | null }
export type DiaryRow = {
  id: string
  projectId: string
  date: string
  weather: string | null
  tempMin: string | null
  tempMax: string | null
  workDescription: string | null
  problemsNoted: string | null
  workersCount: number | null
  updatedAt: string
  photos: DiaryPhoto[]
}

export type IncidentRow = {
  id: string
  projectId: string | null
  severity: string
  description: string
  status: string
  createdAt: string
  photos: { id: string; path: string }[]
}

export type MachineRow = {
  id: string
  name: string
  code: string | null
  type: string
  status: string
  currentWorkingHours: string
  lastLat: string | null
  lastLng: string | null
  lastGpsAt: string | null
  lastGpsSource: 'PHONE' | 'IOT' | null
}

export type TripRow = {
  id: string
  driverId: string
  projectId: string
  machineId: string
  materialId: string
  quantity: string
  originText: string
  unloadedAt: string | null
  loadedAt: string
}

export type FuelRow = {
  id: string
  machineId: string
  projectId: string | null
  liters: string
  unitPrice: string
  totalCost: string
  createdAt: string
}

export type CatalogRow = { id: string; name: string; unit?: string; isActive?: boolean }
