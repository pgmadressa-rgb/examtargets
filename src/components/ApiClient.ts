import type {
  ClassPlan,
  DateRange,
  StudentTracker,
  TermSummary,
  TrackerSummary,
} from '../shared/types.ts';

export interface AppStateResponse {
  activeTermName: string;
  globalDateRange: DateRange;
  skippedNonNovCount: number;
  totalCsvRows: number;
  plans: ClassPlan[];
  trackersSummary: Record<string, TrackerSummary>;
  savedTerms: TermSummary[];
  vapidPublicKey: string;
}

export async function fetchAppState(): Promise<AppStateResponse> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('Failed to load revision planner state.');
  return (await res.json()) as AppStateResponse;
}

export async function uploadCsvPlans(payload: {
  csvText: string;
  onlyNovember2026: boolean;
  startDate: string;
  endDate: string;
  quranEndDate?: string;
}) {
  const res = await fetch('/api/plans/upload-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'CSV import failed.');
  return data as AppStateResponse & {
    importedCount: number;
    skippedCount: number;
    totalRows: number;
    skippedSampleTimestamps: string[];
  };
}

export async function resetSeedPlans() {
  const res = await fetch('/api/plans/reset-seed', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to restore default November 2026 data.');
  return (await res.json()) as AppStateResponse;
}

export async function saveTermSnapshot(name: string) {
  const res = await fetch('/api/terms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save term data.');
  return data as AppStateResponse & { savedTerm: TermSummary };
}

export async function loadTermSnapshot(id: string) {
  const res = await fetch(`/api/terms/${encodeURIComponent(id)}/load`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load saved term.');
  return data as AppStateResponse;
}

export async function deleteTermSnapshot(id: string) {
  const res = await fetch(`/api/terms/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete saved term.');
  return data as AppStateResponse;
}

export async function clearActiveTerm() {
  const res = await fetch('/api/terms/clear', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to clear active term data.');
  return data as AppStateResponse;
}

export async function updateGlobalDateRange(payload: {
  startDate: string;
  endDate: string;
  quranEndDate?: string;
  overwriteManual: boolean;
}) {
  const res = await fetch('/api/plans/date-range', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update date range.');
  return data as {
    globalDateRange: DateRange;
    plans: ClassPlan[];
    trackersSummary: Record<string, TrackerSummary>;
  };
}

export async function updateClassPlan(
  id: string,
  payload: Partial<ClassPlan> & { regenerateFromTeacherInput?: boolean }
) {
  const res = await fetch(`/api/plans/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update class plan.');
  return data as {
    plan: ClassPlan;
    trackersSummary: Record<string, TrackerSummary>;
  };
}

export async function addClassPlan(payload: Partial<ClassPlan>) {
  const res = await fetch('/api/plans/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to add class plan.');
  return data as {
    plan: ClassPlan;
    trackersSummary: Record<string, TrackerSummary>;
  };
}

export async function savePlanSyllabusNotes(
  id: string,
  payload: {
    notes: Record<
      string,
      { subject?: string; content: string; sourceFile?: string; updatedAt?: string }
    >;
    replaceAll?: boolean;
  }
) {
  const res = await fetch(`/api/plans/${encodeURIComponent(id)}/syllabus-notes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save syllabus notes.');
  return data as {
    plan: ClassPlan;
    trackersSummary: Record<string, TrackerSummary>;
  };
}

export async function bulkSaveSyllabusNotes(
  items: Array<{
    classPlanId: string;
    subject: string;
    content: string;
    sourceFile?: string;
  }>
) {
  const res = await fetch('/api/syllabus-notes/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to import syllabus notes.');
  return data as {
    updatedCount: number;
    plans: ClassPlan[];
    trackersSummary: Record<string, TrackerSummary>;
  };
}

export async function deleteClassPlan(id: string) {
  const res = await fetch(`/api/plans/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete class plan.');
  return data as { ok: boolean; trackersSummary: Record<string, TrackerSummary> };
}

export async function fetchClassBySlug(slug: string) {
  const res = await fetch(`/api/track/${encodeURIComponent(slug)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Class link not found.');
  return data as {
    plan: ClassPlan;
    existingStudents: Array<{
      id: string;
      studentName: string;
      selectedGroup: string;
      updatedAt: string;
    }>;
    vapidPublicKey: string;
  };
}

export async function createOrGetStudentTracker(payload: {
  classPlanId: string;
  studentName: string;
  selectedGroup?: string;
}) {
  const res = await fetch('/api/trackers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not start student tracker.');
  return data as {
    tracker: StudentTracker;
    plan: ClassPlan;
    vapidPublicKey: string;
  };
}

export async function fetchTrackerById(trackerId: string) {
  const res = await fetch(`/api/trackers/${encodeURIComponent(trackerId)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Student tracker not found.');
  return data as {
    tracker: StudentTracker;
    plan: ClassPlan;
    vapidPublicKey: string;
    pushPreferences: {
      enabled: boolean;
      reminderTime: string;
      timezone: string;
    } | null;
  };
}

export async function toggleTrackerTask(
  trackerId: string,
  payload: {
    taskId?: string;
    completed?: boolean;
    date?: string;
    note?: string;
    selectedGroup?: string;
    parentSignature?: {
      date: string;
      surname: string | null;
    };
  }
) {
  const res = await fetch(`/api/trackers/${encodeURIComponent(trackerId)}/toggle`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save progress.');
  return data as { tracker: StudentTracker };
}

export async function subscribePushNotifications(payload: {
  trackerId: string;
  classPlanId: string;
  subscription: PushSubscriptionJSON;
  reminderTime: string;
  timezone: string;
  enabled: boolean;
}) {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to subscribe to push reminders.');
  return data as {
    ok: boolean;
    preferences: { enabled: boolean; reminderTime: string; timezone: string };
  };
}

export async function updatePushPreferences(payload: {
  trackerId: string;
  reminderTime?: string;
  timezone?: string;
  enabled?: boolean;
}) {
  const res = await fetch('/api/push/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update reminder preferences.');
  return data as { ok: boolean };
}

export async function sendTestPush(payload: {
  trackerId?: string;
  subscription?: PushSubscriptionJSON;
}) {
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Test push failed.');
  return data as { ok: boolean; sent: number };
}
