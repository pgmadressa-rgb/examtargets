export type TrackType =
  | 'Quran/Panj Para'
  | "Juzz 'Amma"
  | 'Qaidah'
  | 'Islamic Studies Only';

export type TaskCategory =
  | 'quran'
  | 'tajweed'
  | 'surah'
  | 'islamic-studies'
  | 'duas';

export interface RevisionTask {
  id: string;
  category: TaskCategory;
  title: string;
  detail: string;
  group?: string;
  studentTrackerId?: string;
  studentName?: string;
}

export interface RevisionDay {
  date: string; // YYYY-MM-DD
  weekday: string; // Mon, Tue, ...
  dayIndex: number; // 1..N
  tasks: RevisionTask[];
}

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  quranEndDate?: string; // YYYY-MM-DD (Quran, Surahs, Tajweed, Qaidah cutoff)
}

export interface IslamicStudiesTargets {
  enabled: boolean;
  fiqh: string;
  aqaaid: string;
  seerah: string;
  hadith: string;
  adaab: string;
  islamicHistory: string;
  akhlaaq: string;
  duas: string;
  revisionPlanNote: string;
}

export interface ClassTargets {
  quranOrQaidah: string;
  tajweedMakhraj: string;
  surahTargets: string;
  quranDailyQuota: string;
  surahDailyQuota: string;
  islamicStudies: IslamicStudiesTargets;
  extraNotes?: Array<{ label: string; value: string }>;
}

export interface SyllabusNoteEntry {
  subject: string;
  content: string;
  sourceFile?: string;
  updatedAt: string;
}

export interface ClassPlan {
  id: string;
  slug: string;
  timestamp: string;
  submittedMonth: string; // e.g. '2026-11'
  teacherName: string;
  className: string;
  trackType: TrackType;
  targets: ClassTargets;
  groups: string[];
  dateRange: DateRange;
  dailySchedule: RevisionDay[];
  manuallyEdited: boolean;
  syllabusNotes?: Record<string, SyllabusNoteEntry>;
}

export interface ParentSignature {
  surname: string;
  signedAt: string;
}

export interface StudentTracker {
  id: string;
  classPlanId: string;
  classSlug: string;
  studentName: string;
  selectedGroup: string;
  completedTaskIds: Record<string, string>; // taskId -> ISO completedAt
  notesByDay: Record<string, string>;
  parentSignaturesByDay?: Record<string, ParentSignature>; // date -> parent surname signature
  createdAt: string;
  updatedAt: string;
}

export interface TrackerSummary {
  classPlanId: string;
  trackerCount: number;
  averageCompletionPct: number;
  students: Array<{
    id: string;
    studentName: string;
    selectedGroup: string;
    completedCount: number;
    totalTasks: number;
    completionPct: number;
    signedDaysCount?: number;
    updatedAt: string;
  }>;
}

export interface PushSubscriptionInfo {
  id: string;
  trackerId: string;
  classPlanId: string;
  reminderTime: string; // HH:MM
  timezone: string;
  enabled: boolean;
  lastSentDate: string | null;
}

export interface CsvParseResult {
  plans: ClassPlan[];
  totalRows: number;
  includedCount: number;
  skippedCount: number;
  skippedSampleTimestamps: string[];
}

export interface TermSnapshot {
  id: string;
  name: string;
  savedAt: string;
  globalDateRange: DateRange;
  skippedNonNovCount: number;
  totalCsvRows: number;
  plans: ClassPlan[];
  trackers: Record<string, StudentTracker>;
}

export interface TermSummary {
  id: string;
  name: string;
  savedAt: string;
  classCount: number;
  trackerCount: number;
  globalDateRange: DateRange;
}
