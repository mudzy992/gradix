/**
 * `@gradix/domain` — pravila poslovanja koja dijele web, worker i mobilni.
 *
 * NAMJERNO BEZ Node API-ja. Ovaj ulaz uvozi i mobilna aplikacija (Metro bundle), a tamo
 * nema `node:crypto` — modul koji ga traži srušio bi Android bundle tek u CI-ju. Zato su
 * kriptografija i tajne (TOTP, 2FA) u odvojenom ulazu `@gradix/domain/server`, koji
 * uvoze samo server i testovi.
 *
 * Pravilo za dalje: ako modul traži `node:*`, ne ide u ovaj barrel.
 */
export {
  MoneyError,
  SUPPORTED_CURRENCIES,
  add,
  compare,
  isCurrency,
  money,
  multiplyByInteger,
  roundToCents,
  subtract,
  sum,
  toAmountString,
  zero,
  type Currency,
  type Money,
} from "./money";

export {
  computeCostAmount,
  computeHoursFromInterval,
} from "./machine-cost";

/*
 * Faza 4 (Modul 5): razložen trošak mašine, iskorištenost i odstupanje goriva. Izdvojeno iz
 * `machine-cost` jer je R6.1 bio ravna stopa; ovo su komponente, snapshot i dvije kolone
 * iskorištenosti sa definicijom u domeni (spec 05 §1.1–1.3).
 */
export {
  COST_BASES,
  COST_COMPONENTS,
  DEFAULT_PLANNED_HOURS_PER_MONTH,
  FUEL_DEVIATION_REASONS,
  computedRatePerHour,
  fuelConsumption,
  fuelDeviation,
  rateWithKm,
  utilization,
  type ComputedRate,
  type CostBasis,
  type CostComponent,
  type CostComponentRow,
  type FuelDeviation,
  type FuelDeviationReason,
  type UtilizationRow,
  type WorkLogMode,
} from "./machine-cost-components";

export {
  ACCESS_TTL_SECONDS,
  REFRESH_TOKEN_BYTES,
  REFRESH_TTL_DAYS,
  REFRESH_TTL_SECONDS,
  decideRefresh,
  isSessionUsable,
  isValidRefreshTokenFormat,
  refreshExpiry,
  type RefreshDecision,
  type SessionState,
} from "./auth";

export {
  R4_SYNC_CLOCK_SKEW_SECONDS,
  R4_SYNC_PULL_MAX_ITEMS,
  R4_SYNC_PULL_MAX_PAGES_PER_RUN,
  R4_SYNC_PUSH_MAX_BODY_BYTES,
  R4_SYNC_PUSH_MAX_ITEMS,
  R4_SYNC_PUSH_MAX_ITEM_BYTES,
  isOffsetDateTime,
  isR4Uuid,
  isValidCursorSequence,
  validateR4SyncPush,
  type R4SyncEvent,
  type R4SyncPullPage,
  type R4SyncPushItem,
  type R4SyncPushItemResult,
  type R4SyncPushResponse,
  type R4SyncValidationCode,
  type R4SyncValidationResult,
  type R4WorkEntryEndState,
  type R4WorkEntryKind,
  type R4WorkEntryPayload,
  type R4WorkEntryPushItem,
  type R4WorkdayPushItem,
  type R4WorkdayStatus,
  type R4MachineWorkLogMode,
  type R4MachineWorkLogPayload,
  type R4MachineWorkLogPushItem,
  type R4FuelEntryPayload,
  type R4FuelEntryPushItem,
  type R4HaulPayload,
  type R4HaulPushItem,
  type R4HaulQuantityUnit,
  type R4DailyCheckPayload,
  type R4DailyCheckPushItem,
  type R4DailyCheckResult,
  type R4FaultPayload,
  type R4FaultPriority,
  type R4FaultPushItem,
  type R4FaultStatus,
  FAULT_COST_APPROVAL_THRESHOLD_CENTS,
  needsFaultCostApproval,
  validFaultPayload,
} from "./r4-sync";

export {
  BLOCKING_USAGE_ACTIONS,
  USAGE_ACTIONS,
  USAGE_ENTITY_KINDS,
  canUseEntity,
  usageBlockMessage,
  usageBlocks,
  usageWarningMessage,
  type UsageAction,
  type UsageCause,
  type UsageDecision,
  type UsageEntityKind,
  type UsageOverride,
  type UsageSignal,
} from "./can-use-entity";

export {
  ATTACHMENT_ENTITY_TYPES,
  ATTACHMENT_STATUSES,
  MAX_ATTACHMENTS_PER_ENTITY,
  MAX_ATTACHMENT_BYTES,
  attachmentObjectKey,
  isAttachmentEntityType,
  validateAttachmentInput,
  type AttachmentEntityType,
  type AttachmentInputError,
  type AttachmentStatus,
} from "./attachments";

export {
  ABSENCE_DAY_KINDS,
  DAY_KINDS,
  FORGOTTEN_CLOSE_KINDS,
  FORGOTTEN_DAY_HOURS_OPTIONS,
  LEAVE_CONSUMING_DAY_KINDS,
  ROUNDING_MINUTES_OPTIONS,
  ROUNDING_MODES,
  consumesLeave,
  forgottenDayOutcome,
  isAbsenceDay,
  isDayKind,
  isForgottenDay,
  needsOfficeReview,
  overlapMessage,
  roundSegmentMinutes,
  segmentMinutes,
  sumSegmentMinutes,
  workdayReviewState,
  type DayKind,
  type ForgottenCloseKind,
  type RawSegment,
  type RoundingMinutes,
  type RoundingMode,
  type WorkdayReviewState,
} from "./workdays";
export { DEFAULT_TIMEZONE, businessDate, calendarDateFromLocalDate, formatPgDate, isCalendarDate, isValidTimezone, safeTimezone } from "./dates";

export {
  BLOCKING_OBLIGATION_STATES,
  OBLIGATION_REVIEW_STATES,
  OBLIGATION_STATES,
  OBLIGATION_STATE_LABELS,
  OBLIGATION_STATE_ORDER,
  compareObligationUrgency,
  daysBetween,
  daysLeft,
  effectiveThresholds,
  groupMissingByType,
  isObligationState,
  missingObligationsForSubject,
  obligationCoversRequirement,
  obligationState,
  parseThresholds,
  requirementApplies,
  type ExistingObligation,
  type MissingObligation,
  type ObligationRequirement,
  type ObligationReviewState,
  type ObligationState,
  type RequirementEntityKind,
  type RequirementScope,
  type RequirementSubject,
} from "./obligations";

export {
  assignmentBlockMessage,
  checkAssignment,
  isOverrideActive,
  type AssignmentBlocker,
  type AssignmentCheck,
  type AssignmentObligation,
  type AssignmentOverride,
} from "./assignments";

export {
  SCOPES,
  SCOPE_LABELS,
  isScope,
  resolveScope,
  visibleProjectIds,
  type Scope,
  type ScopeActor,
  type ScopedAction,
} from "./scope";

export {
  ACCOUNT_LOCK_ATTEMPTS,
  ACCOUNT_LOCK_MINUTES,
  OFFICE_ROLES_REQUIRING_PASSWORD_ROTATION,
  PASSWORD_FORCED_RESET_DAYS,
  PASSWORD_HISTORY_DEPTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PRE_AUTH_TTL_SECONDS,
  ROLES_REQUIRING_2FA,
  checkPasswordPolicy,
  containsIdentity,
  historyWindow,
  isBlacklistedPassword,
  isPasswordExpired,
  normalizeForBlacklist,
  requires2fa,
  requiresPasswordRotation,
  twoFactorGate,
  type PasswordPolicyInput,
  type TwoFactorGate,
} from "./password-policy";

export {
  PASSWORD_BLACKLIST,
  PASSWORD_BLACKLIST_SET,
} from "./password-blacklist.data";

export {
  describeDevice,
  deviceFingerprint,
  isCurrentDevice,
  isSessionActive,
  sessionsToRevokeOthers,
  type DeviceSession,
} from "./sessions";

/*
 * Faza 5 (Modul 6): projekat kao finansijski kontejner. Napredak, marža, EAC i pragovi budžeta
 * su čiste funkcije — isti broj mora izaći na listi, u detalju, u workeru i u testu.
 */
export {
  BUDGET_THRESHOLD_PCTS,
  COST_ENTRY_STATUSES,
  COST_ENTRY_STATUS_LABELS,
  COST_SOURCE_LABELS,
  COST_SOURCE_TYPES,
  DEFAULT_COST_CATEGORIES,
  FALLBACK_COST_CATEGORY_CODE,
  PHASE_STATUSES,
  PHASE_STATUS_LABELS,
  PROGRESS_SOURCES,
  boqProgress,
  budgetAlertDedupeKey,
  closeChecklist,
  crossedBudgetThreshold,
  estimateAtCompletion,
  projectMargin,
  projectProgress,
  type BoqItemProgressInput,
  type BudgetScopeTotals,
  type BudgetThresholdCrossing,
  type BudgetThresholdInput,
  type BudgetThresholdPct,
  type CloseChecklist,
  type CloseChecklistItem,
  type CostEntryStatus,
  type CostSourceType,
  type EacInput,
  type EacResult,
  type MarginInput,
  type MarginResult,
  type PhaseProgressInput,
  type PhaseStatus,
  type ProgressSource,
} from "./projects";
