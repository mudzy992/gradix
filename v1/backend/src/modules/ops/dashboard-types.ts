export type DashboardCard = {
  key: string;
  value: string | number | null;
};

export type PresencePerson = {
  userId: string;
  firstName: string;
  lastName: string;
  lastSeenAt: Date;
  projectId: string;
};

export type ExpiringDoc = {
  entityType: string;
  entityId: string;
  type: string;
  daysLeft: number;
};

export type DashboardPayload = {
  cards: DashboardCard[];
  presence: PresencePerson[] | null;
  expiring?: ExpiringDoc[];
};
