import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import type webpushTypes from 'web-push';

const require = createRequire(import.meta.url);
const webpush = require('web-push') as typeof webpushTypes;
import {
  DEFAULT_DATE_RANGE,
  detectGroups,
  generateDailySchedule,
  parseMadrasahCsv,
  slugify,
} from './src/shared/planEngine.ts';
import type {
  ClassPlan,
  DateRange,
  PushSubscriptionInfo,
  StudentTracker,
  TermSnapshot,
  TermSummary,
  TrackerSummary,
} from './src/shared/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const VAPID_PATH = path.join(DATA_DIR, 'vapid.json');
const SEED_CSV_PATH = fs.existsSync(
  path.resolve(__dirname, 'public/assets/aistudio/_Revision___Responses__b317a125')
)
  ? path.resolve(__dirname, 'public/assets/aistudio/_Revision___Responses__b317a125')
  : path.resolve(__dirname, 'public/assets/aistudio/_Revision___Responses__9f810d9c');

interface StoredPushRecord extends PushSubscriptionInfo {
  subscription: webpushTypes.PushSubscription;
}

interface StoreData {
  activeTermName: string;
  globalDateRange: DateRange;
  skippedNonNovCount: number;
  totalCsvRows: number;
  plans: ClassPlan[];
  trackers: Record<string, StudentTracker>;
  pushSubscriptions: Record<string, StoredPushRecord>;
  savedTerms: Record<string, TermSnapshot>;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function cleanVapidValue(val: string | undefined): string {
  if (!val) return '';
  let trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed.replace(/=+$/, '');
}

function tryConfigureVapid(keys: VapidKeys): boolean {
  const publicKey = cleanVapidValue(keys.publicKey);
  const privateKey = cleanVapidValue(keys.privateKey);
  if (!publicKey || !privateKey) return false;
  try {
    const pubBuf = Buffer.from(publicKey, 'base64url');
    const privBuf = Buffer.from(privateKey, 'base64url');
    if (pubBuf.length !== 65 || privBuf.length !== 32) {
      return false;
    }
    webpush.setVapidDetails('mailto:pgmadressa@gmail.com', publicKey, privateKey);
    keys.publicKey = publicKey;
    keys.privateKey = privateKey;
    return true;
  } catch {
    return false;
  }
}

function initVapidKeys(): VapidKeys {
  const envPublic = cleanVapidValue(process.env.VAPID_PUBLIC_KEY);
  const envPrivate = cleanVapidValue(process.env.VAPID_PRIVATE_KEY);
  if (envPublic && envPrivate) {
    const envPair: VapidKeys = { publicKey: envPublic, privateKey: envPrivate };
    if (tryConfigureVapid(envPair)) {
      return envPair;
    }
    console.warn('Ignoring invalid VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY env vars; falling back.');
  }

  ensureDataDir();
  if (fs.existsSync(VAPID_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(VAPID_PATH, 'utf-8')) as VapidKeys;
      if (parsed.publicKey && parsed.privateKey && tryConfigureVapid(parsed)) {
        return parsed;
      }
      console.warn('Regenerating invalid data/vapid.json keys.');
    } catch {
      // Regenerate below
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const generated = webpush.generateVAPIDKeys();
    if (tryConfigureVapid(generated)) {
      try {
        fs.writeFileSync(VAPID_PATH, JSON.stringify(generated, null, 2));
      } catch {
        // Ignore read-only disk environments
      }
      return generated;
    }
  }

  return { publicKey: '', privateKey: '' };
}

function createSeedStore(): StoreData {
  let plans: ClassPlan[] = [];
  let skippedNonNovCount = 0;
  let totalCsvRows = 0;

  if (fs.existsSync(SEED_CSV_PATH)) {
    const csvText = fs.readFileSync(SEED_CSV_PATH, 'utf-8');
    const parsed = parseMadrasahCsv(csvText, {
      onlyNovember2026: true,
      dateRange: DEFAULT_DATE_RANGE,
    });
    plans = parsed.plans;
    skippedNonNovCount = parsed.skippedCount;
    totalCsvRows = parsed.totalRows;
  }

  return {
    activeTermName: 'December 2026 Exams',
    globalDateRange: { ...DEFAULT_DATE_RANGE },
    skippedNonNovCount,
    totalCsvRows,
    plans,
    trackers: {},
    pushSubscriptions: {},
    savedTerms: {},
  };
}

function loadStore(): StoreData {
  ensureDataDir();
  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as Partial<StoreData>;
      if (Array.isArray(raw.plans)) {
        const loadedRange = raw.globalDateRange || { ...DEFAULT_DATE_RANGE };
        const needsDec1Migration =
          loadedRange.startDate === '2026-11-18' && loadedRange.endDate === '2026-12-01';
        const effectiveRange = needsDec1Migration ? { ...DEFAULT_DATE_RANGE } : loadedRange;
        const migratedPlans = needsDec1Migration
          ? raw.plans.map((p) =>
              p.manuallyEdited
                ? p
                : {
                    ...p,
                    dateRange: { ...effectiveRange },
                    dailySchedule: generateDailySchedule(
                      p.slug,
                      p.trackType,
                      p.targets,
                      effectiveRange
                    ),
                  }
            )
          : raw.plans;

        const isUntouchedLegacySeed =
          raw.totalCsvRows === 42 &&
          raw.plans.length === 13 &&
          Object.keys(raw.trackers || {}).length === 0 &&
          Object.keys(raw.savedTerms || {}).length === 0 &&
          !raw.plans.some((p) => p.manuallyEdited);
        if (isUntouchedLegacySeed) {
          const upgraded = createSeedStore();
          fs.writeFileSync(STORE_PATH, JSON.stringify(upgraded, null, 2));
          return upgraded;
        }

        const loaded: StoreData = {
          activeTermName: raw.activeTermName || 'December 2026 Exams',
          globalDateRange: effectiveRange,
          skippedNonNovCount: raw.skippedNonNovCount ?? 0,
          totalCsvRows: raw.totalCsvRows ?? migratedPlans.length,
          plans: migratedPlans,
          trackers: raw.trackers || {},
          pushSubscriptions: raw.pushSubscriptions || {},
          savedTerms: raw.savedTerms || {},
        };
        if (needsDec1Migration) {
          fs.writeFileSync(STORE_PATH, JSON.stringify(loaded, null, 2));
        }
        return loaded;
      }
    } catch {
      // Fall back to seed
    }
  }
  const seed = createSeedStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2));
  return seed;
}

let store: StoreData = loadStore();

function saveStore(): void {
  ensureDataDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

const vapidKeys = initVapidKeys();

function getRelevantTasksForTracker(plan: ClassPlan, tracker: StudentTracker) {
  const allTasks = plan.dailySchedule.flatMap((d) => d.tasks);
  if (!tracker.selectedGroup || tracker.selectedGroup === 'All' || plan.groups.length === 0) {
    return allTasks;
  }
  return allTasks.filter((t) => !t.group || t.group === tracker.selectedGroup);
}

function buildTrackerSummaries(): Record<string, TrackerSummary> {
  const summaries: Record<string, TrackerSummary> = {};
  for (const plan of store.plans) {
    const classTrackers = Object.values(store.trackers).filter(
      (t) => t.classPlanId === plan.id
    );
    const students = classTrackers.map((t) => {
      const tasks = getRelevantTasksForTracker(plan, t);
      const totalTasks = tasks.length;
      const completedCount = tasks.filter((task) => Boolean(t.completedTaskIds[task.id])).length;
      const completionPct = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;
      return {
        id: t.id,
        studentName: t.studentName,
        selectedGroup: t.selectedGroup,
        completedCount,
        totalTasks,
        completionPct,
        updatedAt: t.updatedAt,
      };
    });

    const avg =
      students.length > 0
        ? Math.round(students.reduce((acc, s) => acc + s.completionPct, 0) / students.length)
        : 0;

    summaries[plan.id] = {
      classPlanId: plan.id,
      trackerCount: students.length,
      averageCompletionPct: avg,
      students,
    };
  }
  return summaries;
}

function getLocalDateAndTime(tz: string): { date: string; time: string } {
  const now = new Date();
  try {
    const dateFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const timeFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return {
      date: dateFmt.format(now),
      time: timeFmt.format(now),
    };
  } catch {
    return {
      date: now.toISOString().slice(0, 10),
      time: now.toISOString().slice(11, 16),
    };
  }
}

function buildPushPayloadForRecord(record: StoredPushRecord, localDate: string) {
  const plan = store.plans.find((p) => p.id === record.classPlanId);
  const tracker = store.trackers[record.trackerId];
  if (!plan) {
    return {
      title: 'Maktab Revision Reminder',
      body: 'Open your revision tracker to check off today’s exam targets.',
      url: '/',
      tag: `maktab-${record.trackerId}`,
    };
  }

  const day =
    plan.dailySchedule.find((d) => d.date === localDate) || plan.dailySchedule[0];
  const tasks = day
    ? day.tasks.filter(
        (t) =>
          !tracker?.selectedGroup ||
          tracker.selectedGroup === 'All' ||
          !t.group ||
          t.group === tracker.selectedGroup
      )
    : [];

  const remaining = tracker
    ? tasks.filter((t) => !tracker.completedTaskIds[t.id])
    : tasks;

  const studentLabel = tracker ? `${tracker.studentName} (${plan.className})` : plan.className;
  const body =
    remaining.length > 0
      ? `${remaining.length} tasks today: ${remaining
          .slice(0, 2)
          .map((t) => t.title)
          .join(', ')}${remaining.length > 2 ? '…' : ''}`
      : `All ${tasks.length} tasks for ${plan.className} are complete today!`;

  const url = tracker ? `/?tracker=${tracker.id}` : `/?track=${plan.slug}`;

  return {
    title: `Daily Revision · ${studentLabel}`,
    body,
    url,
    tag: `maktab-${record.trackerId}-${localDate}`,
  };
}

async function runPushSchedulerTick(): Promise<void> {
  const entries = Object.values(store.pushSubscriptions);
  if (entries.length === 0) return;

  let dirty = false;
  for (const record of entries) {
    if (!record.enabled) continue;
    const { date, time } = getLocalDateAndTime(record.timezone || 'Europe/London');
    if (record.lastSentDate === date) continue;
    if (time !== record.reminderTime) continue;

    const payload = buildPushPayloadForRecord(record, date);
    try {
      await webpush.sendNotification(record.subscription, JSON.stringify(payload));
      record.lastSentDate = date;
      dirty = true;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        delete store.pushSubscriptions[record.id];
        dirty = true;
      }
    }
  }
  if (dirty) {
    saveStore();
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, plans: store.plans.length });
  });

  function buildTermSummaries(): TermSummary[] {
    return Object.values(store.savedTerms)
      .map((t) => ({
        id: t.id,
        name: t.name,
        savedAt: t.savedAt,
        classCount: t.plans.length,
        trackerCount: Object.keys(t.trackers).length,
        globalDateRange: t.globalDateRange,
      }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  function buildStateResponse() {
    return {
      activeTermName: store.activeTermName,
      globalDateRange: store.globalDateRange,
      skippedNonNovCount: store.skippedNonNovCount,
      totalCsvRows: store.totalCsvRows,
      plans: store.plans,
      trackersSummary: buildTrackerSummaries(),
      savedTerms: buildTermSummaries(),
      vapidPublicKey: vapidKeys.publicKey,
    };
  }

  app.get('/api/state', (_req, res) => {
    res.json(buildStateResponse());
  });

  app.post('/api/terms', (req, res) => {
    const body = req.body as { name?: string };
    const cleanName = (body.name || store.activeTermName || 'Exam Revision Term').trim();
    const id = slugify(cleanName) || `term-${Date.now().toString(36)}`;
    const snapshot: TermSnapshot = {
      id,
      name: cleanName,
      savedAt: new Date().toISOString(),
      globalDateRange: { ...store.globalDateRange },
      skippedNonNovCount: store.skippedNonNovCount,
      totalCsvRows: store.totalCsvRows,
      plans: JSON.parse(JSON.stringify(store.plans)) as ClassPlan[],
      trackers: JSON.parse(JSON.stringify(store.trackers)) as Record<string, StudentTracker>,
    };
    store.savedTerms[id] = snapshot;
    store.activeTermName = cleanName;
    saveStore();
    res.status(201).json({
      savedTerm: {
        id: snapshot.id,
        name: snapshot.name,
        savedAt: snapshot.savedAt,
        classCount: snapshot.plans.length,
        trackerCount: Object.keys(snapshot.trackers).length,
        globalDateRange: snapshot.globalDateRange,
      },
      ...buildStateResponse(),
    });
  });

  app.post('/api/terms/:id/load', (req, res) => {
    const snapshot = store.savedTerms[req.params.id];
    if (!snapshot) {
      res.status(404).json({ error: 'Saved term not found.' });
      return;
    }
    store.activeTermName = snapshot.name;
    store.globalDateRange = { ...snapshot.globalDateRange };
    store.skippedNonNovCount = snapshot.skippedNonNovCount;
    store.totalCsvRows = snapshot.totalCsvRows;
    store.plans = JSON.parse(JSON.stringify(snapshot.plans)) as ClassPlan[];
    store.trackers = JSON.parse(JSON.stringify(snapshot.trackers)) as Record<string, StudentTracker>;
    saveStore();
    res.json(buildStateResponse());
  });

  app.delete('/api/terms/:id', (req, res) => {
    const target = store.savedTerms[req.params.id];
    if (!target) {
      res.status(404).json({ error: 'Saved term not found.' });
      return;
    }
    delete store.savedTerms[req.params.id];
    saveStore();
    res.json(buildStateResponse());
  });

  app.post('/api/terms/clear', (_req, res) => {
    store.plans = [];
    store.trackers = {};
    store.skippedNonNovCount = 0;
    store.totalCsvRows = 0;
    store.activeTermName = 'New Empty Term';
    saveStore();
    res.json(buildStateResponse());
  });

  app.post('/api/plans/upload-csv', (req, res) => {
    const body = req.body as {
      csvText?: string;
      onlyNovember2026?: boolean;
      startDate?: string;
      endDate?: string;
    };
    const dateRange: DateRange = {
      startDate: body.startDate || store.globalDateRange.startDate,
      endDate: body.endDate || store.globalDateRange.endDate,
    };
    const opts = {
      onlyNovember2026: body.onlyNovember2026 ?? true,
      dateRange,
    };

    if (!body.csvText || typeof body.csvText !== 'string') {
      res.status(400).json({ error: 'CSV content is required.' });
      return;
    }

    const result = parseMadrasahCsv(body.csvText, opts);

    if (result.plans.length === 0) {
      res.status(400).json({
        error:
          'No matching November 2026 teacher rows were found. Uncheck the November 2026 filter if your sheet uses different dates, or verify the Timestamp column.',
      });
      return;
    }

    store.globalDateRange = dateRange;
    store.plans = result.plans;
    store.skippedNonNovCount = result.skippedCount;
    store.totalCsvRows = result.totalRows;
    saveStore();

    res.json({
      importedCount: result.includedCount,
      skippedCount: result.skippedCount,
      totalRows: result.totalRows,
      skippedSampleTimestamps: result.skippedSampleTimestamps,
      ...buildStateResponse(),
    });
  });

  app.post('/api/plans/reset-seed', (_req, res) => {
    const existingTrackers = store.trackers;
    const existingPush = store.pushSubscriptions;
    const existingSavedTerms = store.savedTerms;
    const seeded = createSeedStore();
    store = {
      ...seeded,
      trackers: existingTrackers,
      pushSubscriptions: existingPush,
      savedTerms: existingSavedTerms,
    };
    saveStore();
    res.json(buildStateResponse());
  });

  app.post('/api/plans/add', (req, res) => {
    const body = req.body as Partial<ClassPlan>;
    if (!body.teacherName?.trim() || !body.className?.trim()) {
      res.status(400).json({ error: 'Teacher name and class name are required.' });
      return;
    }

    const existingSlugs = new Set(store.plans.map((p) => p.slug));
    const baseSlug = slugify(`${body.teacherName}-${body.className}`);
    let slug = baseSlug;
    let i = 2;
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${i++}`;
    }

    const targets = body.targets || {
      quranOrQaidah: 'NA',
      tajweedMakhraj: 'NA',
      surahTargets: 'NA',
      quranDailyQuota: 'NA',
      surahDailyQuota: 'NA',
      islamicStudies: {
        enabled: true,
        fiqh: '',
        aqaaid: '',
        seerah: '',
        hadith: '',
        adaab: '',
        islamicHistory: '',
        akhlaaq: '',
        duas: '',
        revisionPlanNote: '',
      },
    };
    const trackType = body.trackType || 'Quran/Panj Para';
    const dateRange = body.dateRange || store.globalDateRange;
    const groups = detectGroups(targets);
    const dailySchedule = generateDailySchedule(slug, trackType, targets, dateRange);

    const newPlan: ClassPlan = {
      id: `plan-${slug}`,
      slug,
      timestamp: new Date().toLocaleDateString('en-GB') + ' ' + new Date().toTimeString().slice(0, 8),
      submittedMonth: '2026-11',
      teacherName: body.teacherName.trim(),
      className: body.className.trim(),
      trackType,
      targets,
      groups,
      dateRange,
      dailySchedule,
      manuallyEdited: false,
    };

    store.plans.unshift(newPlan);
    saveStore();
    res.status(201).json({ plan: newPlan, trackersSummary: buildTrackerSummaries() });
  });

  app.put('/api/plans/date-range', (req, res) => {
    const body = req.body as { startDate?: string; endDate?: string; overwriteManual?: boolean };
    if (!body.startDate || !body.endDate) {
      res.status(400).json({ error: 'Both startDate and endDate are required.' });
      return;
    }
    const newRange: DateRange = { startDate: body.startDate, endDate: body.endDate };
    store.globalDateRange = newRange;
    store.plans = store.plans.map((plan) => {
      if (plan.manuallyEdited && !body.overwriteManual) {
        return plan;
      }
      return {
        ...plan,
        dateRange: { ...newRange },
        dailySchedule: generateDailySchedule(plan.slug, plan.trackType, plan.targets, newRange),
        manuallyEdited: false,
      };
    });
    saveStore();
    res.json({
      globalDateRange: store.globalDateRange,
      plans: store.plans,
      trackersSummary: buildTrackerSummaries(),
    });
  });

  app.put('/api/plans/:id', (req, res) => {
    const idx = store.plans.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Class plan not found.' });
      return;
    }
    const existing = store.plans[idx];
    const body = req.body as Partial<ClassPlan> & { regenerateFromTeacherInput?: boolean };

    const nextTargets = body.targets ?? existing.targets;
    const nextTrack = body.trackType ?? existing.trackType;
    const nextRange = body.dateRange ?? existing.dateRange;
    const groups = detectGroups(nextTargets);

    const dailySchedule = body.regenerateFromTeacherInput
      ? generateDailySchedule(existing.slug, nextTrack, nextTargets, nextRange)
      : body.dailySchedule ?? existing.dailySchedule;

    const scheduleOrTargetsEdited =
      body.dailySchedule !== undefined ||
      body.targets !== undefined ||
      body.trackType !== undefined ||
      body.dateRange !== undefined;

    const updated: ClassPlan = {
      ...existing,
      teacherName: body.teacherName?.trim() || existing.teacherName,
      className: body.className?.trim() || existing.className,
      trackType: nextTrack,
      targets: nextTargets,
      groups,
      dateRange: nextRange,
      dailySchedule,
      manuallyEdited: body.regenerateFromTeacherInput
        ? false
        : body.manuallyEdited ?? (scheduleOrTargetsEdited ? true : existing.manuallyEdited),
    };

    store.plans[idx] = updated;
    saveStore();
    res.json({ plan: updated, trackersSummary: buildTrackerSummaries() });
  });

  app.delete('/api/plans/:id', (req, res) => {
    const before = store.plans.length;
    store.plans = store.plans.filter((p) => p.id !== req.params.id);
    if (store.plans.length === before) {
      res.status(404).json({ error: 'Class plan not found.' });
      return;
    }
    saveStore();
    res.json({ ok: true, trackersSummary: buildTrackerSummaries() });
  });

  app.get('/api/track/:slug', (req, res) => {
    const plan = store.plans.find((p) => p.slug === req.params.slug || p.id === req.params.slug);
    if (!plan) {
      res.status(404).json({ error: 'Class revision link not found.' });
      return;
    }
    const existingStudents = Object.values(store.trackers)
      .filter((t) => t.classPlanId === plan.id)
      .map((t) => ({
        id: t.id,
        studentName: t.studentName,
        selectedGroup: t.selectedGroup,
        updatedAt: t.updatedAt,
      }));
    res.json({ plan, existingStudents, vapidPublicKey: vapidKeys.publicKey });
  });

  app.post('/api/trackers', (req, res) => {
    const body = req.body as {
      classPlanId?: string;
      studentName?: string;
      selectedGroup?: string;
    };
    const plan = store.plans.find((p) => p.id === body.classPlanId);
    if (!plan) {
      res.status(404).json({ error: 'Class plan not found.' });
      return;
    }
    const cleanName = (body.studentName || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'Student name is required.' });
      return;
    }

    const selectedGroup = body.selectedGroup || (plan.groups[0] ?? 'All');
    const existing = Object.values(store.trackers).find(
      (t) =>
        t.classPlanId === plan.id &&
        t.studentName.toLowerCase() === cleanName.toLowerCase()
    );
    if (existing) {
      if (body.selectedGroup && existing.selectedGroup !== body.selectedGroup) {
        existing.selectedGroup = body.selectedGroup;
        existing.updatedAt = new Date().toISOString();
        saveStore();
      }
      res.json({ tracker: existing, plan, vapidPublicKey: vapidKeys.publicKey });
      return;
    }

    const id = `${plan.slug}-${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();
    const tracker: StudentTracker = {
      id,
      classPlanId: plan.id,
      classSlug: plan.slug,
      studentName: cleanName,
      selectedGroup,
      completedTaskIds: {},
      notesByDay: {},
      createdAt: now,
      updatedAt: now,
    };
    store.trackers[id] = tracker;
    saveStore();
    res.status(201).json({ tracker, plan, vapidPublicKey: vapidKeys.publicKey });
  });

  app.get('/api/trackers/:trackerId', (req, res) => {
    const tracker = store.trackers[req.params.trackerId];
    if (!tracker) {
      res.status(404).json({ error: 'Student tracker not found.' });
      return;
    }
    const plan = store.plans.find((p) => p.id === tracker.classPlanId);
    if (!plan) {
      res.status(404).json({ error: 'Associated class plan not found.' });
      return;
    }
    const pushSub = Object.values(store.pushSubscriptions).find(
      (s) => s.trackerId === tracker.id
    );
    res.json({
      tracker,
      plan,
      vapidPublicKey: vapidKeys.publicKey,
      pushPreferences: pushSub
        ? {
            enabled: pushSub.enabled,
            reminderTime: pushSub.reminderTime,
            timezone: pushSub.timezone,
          }
        : null,
    });
  });

  app.patch('/api/trackers/:trackerId/toggle', (req, res) => {
    const tracker = store.trackers[req.params.trackerId];
    if (!tracker) {
      res.status(404).json({ error: 'Student tracker not found.' });
      return;
    }
    const body = req.body as {
      taskId?: string;
      completed?: boolean;
      date?: string;
      note?: string;
      selectedGroup?: string;
    };

    if (body.taskId) {
      if (body.completed) {
        tracker.completedTaskIds[body.taskId] = new Date().toISOString();
      } else {
        delete tracker.completedTaskIds[body.taskId];
      }
    }
    if (body.date !== undefined && body.note !== undefined) {
      if (body.note.trim()) {
        tracker.notesByDay[body.date] = body.note;
      } else {
        delete tracker.notesByDay[body.date];
      }
    }
    if (body.selectedGroup) {
      tracker.selectedGroup = body.selectedGroup;
    }

    tracker.updatedAt = new Date().toISOString();
    saveStore();
    res.json({ tracker });
  });

  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post('/api/push/subscribe', (req, res) => {
    const body = req.body as {
      trackerId?: string;
      classPlanId?: string;
      subscription?: webpushTypes.PushSubscription;
      reminderTime?: string;
      timezone?: string;
      enabled?: boolean;
    };
    if (!body.subscription?.endpoint || !body.trackerId || !body.classPlanId) {
      res.status(400).json({ error: 'Valid push subscription, trackerId, and classPlanId are required.' });
      return;
    }
    const subId = crypto
      .createHash('sha256')
      .update(`${body.trackerId}:${body.subscription.endpoint}`)
      .digest('hex')
      .slice(0, 16);

    const record: StoredPushRecord = {
      id: subId,
      trackerId: body.trackerId,
      classPlanId: body.classPlanId,
      subscription: body.subscription,
      reminderTime: body.reminderTime || '17:00',
      timezone: body.timezone || 'Europe/London',
      enabled: body.enabled ?? true,
      lastSentDate: null,
    };
    store.pushSubscriptions[subId] = record;
    saveStore();
    res.json({
      ok: true,
      preferences: {
        enabled: record.enabled,
        reminderTime: record.reminderTime,
        timezone: record.timezone,
      },
    });
  });

  app.patch('/api/push/preferences', (req, res) => {
    const body = req.body as {
      trackerId?: string;
      reminderTime?: string;
      timezone?: string;
      enabled?: boolean;
    };
    if (!body.trackerId) {
      res.status(400).json({ error: 'trackerId is required.' });
      return;
    }
    const matches = Object.values(store.pushSubscriptions).filter(
      (s) => s.trackerId === body.trackerId
    );
    if (matches.length === 0) {
      res.status(404).json({ error: 'No push subscription registered for this tracker yet.' });
      return;
    }
    for (const m of matches) {
      if (body.reminderTime) m.reminderTime = body.reminderTime;
      if (body.timezone) m.timezone = body.timezone;
      if (typeof body.enabled === 'boolean') m.enabled = body.enabled;
    }
    saveStore();
    res.json({ ok: true });
  });

  app.post('/api/push/test', async (req, res) => {
    const body = req.body as {
      trackerId?: string;
      subscription?: webpushTypes.PushSubscription;
    };
    let targetRecords = body.trackerId
      ? Object.values(store.pushSubscriptions).filter((s) => s.trackerId === body.trackerId)
      : [];

    if (targetRecords.length === 0 && body.subscription?.endpoint) {
      const dummyRecord: StoredPushRecord = {
        id: 'adhoc',
        trackerId: body.trackerId || 'preview',
        classPlanId: store.trackers[body.trackerId || '']?.classPlanId || store.plans[0]?.id || '',
        subscription: body.subscription,
        reminderTime: '17:00',
        timezone: 'Europe/London',
        enabled: true,
        lastSentDate: null,
      };
      targetRecords = [dummyRecord];
    }

    if (targetRecords.length === 0) {
      res.status(404).json({ error: 'Enable daily push reminders on this device first.' });
      return;
    }

    let sent = 0;
    for (const rec of targetRecords) {
      const { date } = getLocalDateAndTime(rec.timezone);
      const payload = buildPushPayloadForRecord(rec, date);
      try {
        await webpush.sendNotification(rec.subscription, JSON.stringify(payload));
        sent++;
      } catch {
        // Ignore stale endpoint
      }
    }

    if (sent === 0) {
      res.status(502).json({ error: 'Push delivery failed. Please re-enable notifications.' });
      return;
    }

    res.json({ ok: true, sent });
  });

  setInterval(() => {
    void runPushSchedulerTick();
  }, 30_000);

  if (process.env.NODE_ENV !== 'production') {
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    decline() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(id) { return id; }
export const ErrorOverlay = class {};
`);
    });
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Maktab Revision Planner running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
