import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  PenLine,
  Send,
  Star,
} from 'lucide-react';
import {
  formatOrdinalDate,
  groupDaysIntoWeeks,
} from '../shared/planEngine.ts';
import type { ClassPlan, RevisionTask, StudentTracker } from '../shared/types.ts';
import {
  createOrGetStudentTracker,
  fetchClassBySlug,
  fetchTrackerById,
  sendTestPush,
  subscribePushNotifications,
  toggleTrackerTask,
  updatePushPreferences,
} from './ApiClient.ts';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface MobileQrTrackerProps {
  classSlug?: string;
  trackerId?: string;
  onExitToAdmin?: () => void;
  onTrackerUpdated?: () => void;
}

function isTaskForTracker(task: RevisionTask, t: StudentTracker): boolean {
  if (task.studentTrackerId) {
    return task.studentTrackerId === t.id;
  }
  return t.selectedGroup === 'All' || !task.group || task.group === t.selectedGroup;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function formatDayChip(iso: string): { dow: string; num: string; month: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  return {
    dow: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    num: String(d.getUTCDate()),
    month: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }),
  };
}

export const MobileQrTracker: React.FC<MobileQrTrackerProps> = ({
  classSlug,
  trackerId,
  onExitToAdmin,
  onTrackerUpdated,
}) => {
  const [plan, setPlan] = useState<ClassPlan | null>(null);
  const [tracker, setTracker] = useState<StudentTracker | null>(null);
  const [vapidPublicKey, setVapidPublicKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Onboarding form
  const [studentName, setStudentName] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('All');

  // Active Day selection & Kid-friendly Weekly/Daily Views
  const [trackerView, setTrackerView] = useState<'weekly' | 'daily'>('weekly');
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [activeDate, setActiveDate] = useState('');
  const [dayNote, setDayNote] = useState('');
  const [noteSavedMsg, setNoteSavedMsg] = useState<string | null>(null);

  // Parent Surname Daily Sign-Off State
  const [signingDate, setSigningDate] = useState<string | null>(null);
  const [surnameInput, setSurnameInput] = useState('');
  const [cardSurnameInput, setCardSurnameInput] = useState('');
  const [signSavedMsg, setSignSavedMsg] = useState<string | null>(null);

  // Push Notification State
  const [reminderTime, setReminderTime] = useState('17:00');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  const browserTz =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London'
      : 'Europe/London';

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (trackerId) {
          const data = await fetchTrackerById(trackerId);
          if (!active) return;
          setPlan(data.plan);
          setTracker(data.tracker);
          setVapidPublicKey(data.vapidPublicKey);
          setSelectedGroup(data.tracker.selectedGroup);
          if (data.pushPreferences) {
            setPushEnabled(data.pushPreferences.enabled);
            setReminderTime(data.pushPreferences.reminderTime);
          }
          const todayIso = new Date().toISOString().slice(0, 10);
          const matchDay =
            data.plan.dailySchedule.find((d) => d.date === todayIso) ||
            data.plan.dailySchedule[0];
          if (matchDay) {
            setActiveDate(matchDay.date);
            setDayNote(data.tracker.notesByDay[matchDay.date] || '');
            setCardSurnameInput(data.tracker.parentSignaturesByDay?.[matchDay.date]?.surname || '');
          }
        } else if (classSlug) {
          const savedTrackerId = localStorage.getItem(`maktab-tracker-${classSlug}`);
          if (savedTrackerId) {
            try {
              const saved = await fetchTrackerById(savedTrackerId);
              if (!active) return;
              setPlan(saved.plan);
              setTracker(saved.tracker);
              setVapidPublicKey(saved.vapidPublicKey);
              setSelectedGroup(saved.tracker.selectedGroup);
              if (saved.pushPreferences) {
                setPushEnabled(saved.pushPreferences.enabled);
                setReminderTime(saved.pushPreferences.reminderTime);
              }
              const todayIso = new Date().toISOString().slice(0, 10);
              const matchDay =
                saved.plan.dailySchedule.find((d) => d.date === todayIso) ||
                saved.plan.dailySchedule[0];
              if (matchDay) {
                setActiveDate(matchDay.date);
                setDayNote(saved.tracker.notesByDay[matchDay.date] || '');
                setCardSurnameInput(
                  saved.tracker.parentSignaturesByDay?.[matchDay.date]?.surname || ''
                );
              }
              setLoading(false);
              return;
            } catch {
              localStorage.removeItem(`maktab-tracker-${classSlug}`);
            }
          }

          const data = await fetchClassBySlug(classSlug);
          if (!active) return;
          setPlan(data.plan);
          setVapidPublicKey(data.vapidPublicKey);
          setSelectedGroup(data.plan.groups[0] ?? 'All');
        }
      } catch (err) {
        if (!active) return;
        setError((err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [classSlug, trackerId]);

  const handleStartStudent = async (nameToUse: string, groupToUse?: string) => {
    if (!plan || !nameToUse.trim()) return;
    setLoading(true);
    try {
      const res = await createOrGetStudentTracker({
        classPlanId: plan.id,
        studentName: nameToUse.trim(),
        selectedGroup: groupToUse ?? selectedGroup,
      });
      setTracker(res.tracker);
      setPlan(res.plan);
      setVapidPublicKey(res.vapidPublicKey);
      localStorage.setItem(`maktab-tracker-${plan.slug}`, res.tracker.id);
      const todayIso = new Date().toISOString().slice(0, 10);
      const matchDay =
        res.plan.dailySchedule.find((d) => d.date === todayIso) || res.plan.dailySchedule[0];
      if (matchDay) {
        setActiveDate(matchDay.date);
        setDayNote(res.tracker.notesByDay[matchDay.date] || '');
        setCardSurnameInput(res.tracker.parentSignaturesByDay?.[matchDay.date]?.surname || '');
      }
      onTrackerUpdated?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const visibleScheduleDays = useMemo(() => {
    if (!plan) return [];
    if (includeWeekends) return plan.dailySchedule;
    return plan.dailySchedule.filter((d) => {
      const dow = new Date(`${d.date}T12:00:00Z`).getUTCDay();
      return dow >= 1 && dow <= 5;
    });
  }, [plan, includeWeekends]);

  const weekGroups = useMemo(() => {
    if (!plan) return [];
    return groupDaysIntoWeeks(plan.dailySchedule, includeWeekends);
  }, [plan, includeWeekends]);

  const activeDay = useMemo(() => {
    if (visibleScheduleDays.length === 0) return null;
    return (
      visibleScheduleDays.find((d) => d.date === activeDate) || visibleScheduleDays[0] || null
    );
  }, [visibleScheduleDays, activeDate]);

  const activeDayTasks = useMemo(() => {
    if (!activeDay || !tracker) return [];
    return activeDay.tasks.filter((t) => isTaskForTracker(t, tracker));
  }, [activeDay, tracker]);

  const lastUsedParentSurname = useMemo(() => {
    const entries = Object.values(tracker?.parentSignaturesByDay ?? {});
    if (entries.length === 0) return '';
    entries.sort((a, b) => b.signedAt.localeCompare(a.signedAt));
    return entries[0]?.surname || '';
  }, [tracker?.parentSignaturesByDay]);

  const signedDaysCount = useMemo(() => {
    if (!tracker) return 0;
    const sigs = tracker.parentSignaturesByDay ?? {};
    return visibleScheduleDays.filter((d) => Boolean(sigs[d.date]?.surname)).length;
  }, [tracker, visibleScheduleDays]);

  const overallProgress = useMemo(() => {
    if (!plan || !tracker) return { done: 0, total: 0, pct: 0 };
    const relevant = visibleScheduleDays
      .flatMap((d) => d.tasks)
      .filter((t) => isTaskForTracker(t, tracker));
    const done = relevant.filter((t) => Boolean(tracker.completedTaskIds[t.id])).length;
    const total = relevant.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, pct };
  }, [plan, tracker, visibleScheduleDays]);

  const encouragementText = useMemo(() => {
    if (overallProgress.total > 0 && overallProgress.done === overallProgress.total) {
      return 'Mashallah! Every revision task is ticked!';
    }
    if (overallProgress.pct >= 50) {
      return 'Amazing effort — more than halfway done!';
    }
    if (overallProgress.done > 0) {
      return 'Great start! Keep ticking each target.';
    }
    return 'Tick each box once done, then ask a parent to sign.';
  }, [overallProgress]);

  const formatMobileSubject = (task: RevisionTask): string => {
    if (task.category === 'surah') return 'Surahs';
    if (task.category === 'quran') {
      if (plan?.trackType === 'Qaidah') return 'Ahsanul Qawaaid';
      if (plan?.trackType === "Juzz 'Amma") return "Juzz 'Amma";
      return 'Quran';
    }
    if (task.category === 'tajweed') return 'Tajweed';
    if (task.category === 'duas') return 'Duas';
    return task.title || 'Islamic Studies';
  };

  const handleToggleTask = async (taskId: string) => {
    if (!tracker) return;
    const nextCompleted = !tracker.completedTaskIds[taskId];
    const optimistic = { ...tracker.completedTaskIds };
    if (nextCompleted) optimistic[taskId] = new Date().toISOString();
    else delete optimistic[taskId];

    setTracker({ ...tracker, completedTaskIds: optimistic });
    try {
      const res = await toggleTrackerTask(tracker.id, {
        taskId,
        completed: nextCompleted,
      });
      setTracker(res.tracker);
      onTrackerUpdated?.();
    } catch {
      setTracker(tracker);
    }
  };

  const handleSaveParentSignature = async (date: string, surname: string | null) => {
    if (!tracker) return;
    const clean = surname ? surname.trim() : '';
    const nextSigs = { ...(tracker.parentSignaturesByDay ?? {}) };
    if (clean) {
      nextSigs[date] = { surname: clean, signedAt: new Date().toISOString() };
    } else {
      delete nextSigs[date];
    }

    setTracker({ ...tracker, parentSignaturesByDay: nextSigs });
    try {
      const res = await toggleTrackerTask(tracker.id, {
        parentSignature: { date, surname: clean || null },
      });
      setTracker(res.tracker);
      setSigningDate(null);
      setSurnameInput('');
      if (activeDate === date) {
        setCardSurnameInput(clean);
      }
      setSignSavedMsg(clean ? `Signed by ${clean}` : 'Signature cleared');
      setTimeout(() => setSignSavedMsg(null), 2200);
      onTrackerUpdated?.();
    } catch {
      setTracker(tracker);
    }
  };

  const handleSaveNote = async () => {
    if (!tracker || !activeDay) return;
    try {
      const res = await toggleTrackerTask(tracker.id, {
        date: activeDay.date,
        note: dayNote,
      });
      setTracker(res.tracker);
      setNoteSavedMsg('Note saved');
      setTimeout(() => setNoteSavedMsg(null), 2000);
    } catch (err) {
      setNoteSavedMsg((err as Error).message);
    }
  };

  const handleEnablePush = async () => {
    if (!tracker || !plan) return;
    setPushBusy(true);
    setPushStatus(null);
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        throw new Error('Push notifications are not supported in this browser.');
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error(
          'Notification permission was blocked. If viewing inside a preview frame, open this QR link in a full browser tab or installed PWA.'
        );
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        if (!vapidPublicKey) {
          throw new Error('Server push key unavailable.');
        }
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        });
      }

      await subscribePushNotifications({
        trackerId: tracker.id,
        classPlanId: plan.id,
        subscription: subscription.toJSON(),
        reminderTime,
        timezone: browserTz,
        enabled: true,
      });

      setPushEnabled(true);
      setPushStatus(`Daily push reminders scheduled for ${reminderTime} (${browserTz}).`);
    } catch (err) {
      setPushStatus((err as Error).message);
    } finally {
      setPushBusy(false);
    }
  };

  const handleTimeChange = async (newTime: string) => {
    setReminderTime(newTime);
    if (!tracker || !pushEnabled) return;
    try {
      await updatePushPreferences({
        trackerId: tracker.id,
        reminderTime: newTime,
        timezone: browserTz,
        enabled: true,
      });
      setPushStatus(`Reminder time updated to ${newTime}.`);
    } catch {
      // Ignore if not yet subscribed
    }
  };

  const handleSendTestPush = async () => {
    if (!tracker) return;
    setPushBusy(true);
    setPushStatus(null);
    try {
      await sendTestPush({ trackerId: tracker.id });
      setPushStatus('Test push notification dispatched! Check your device alerts.');
    } catch (err) {
      if ('Notification' in window && Notification.permission === 'granted' && activeDayTasks.length > 0) {
        new Notification(`Daily Revision · ${tracker.studentName}`, {
          body: `${activeDayTasks.length} tasks scheduled today: ${activeDayTasks[0].title}`,
          icon: '/pwa-192x192.png',
        });
        setPushStatus('Triggered local browser reminder notification.');
      } else {
        setPushStatus((err as Error).message);
      }
    } finally {
      setPushBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6 space-y-4">
        <div className="h-14 rounded-2xl bg-slate-200 animate-pulse" />
        <div className="h-32 rounded-2xl bg-slate-200 animate-pulse" />
        <div className="h-48 rounded-2xl bg-slate-200 animate-pulse" />
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-3">
          <h2 className="text-lg font-bold text-slate-900">Revision Link Not Found</h2>
          <p className="text-sm text-slate-600">{error || 'Please scan the class QR code again.'}</p>
          {onExitToAdmin && (
            <button
              type="button"
              onClick={onExitToAdmin}
              className="min-h-[44px] rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Return to Admin Report
            </button>
          )}
        </div>
      </div>
    );
  }

  // Step 1: Student Identification Screen (when opening general Class QR)
  if (!tracker) {
    return (
      <div className="min-h-screen bg-[#FAF8F3] px-4 py-8">
        <div className="mx-auto max-w-xl space-y-6">
          {onExitToAdmin && (
            <button
              type="button"
              onClick={onExitToAdmin}
              className="inline-flex min-h-[40px] items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Admin Workspace
            </button>
          )}

          <div className="rounded-3xl border border-amber-200/80 bg-white p-6 sm:p-8 space-y-5 shadow-xs">
            <div>
              <p className="text-xs font-semibold text-teal-800">
                {plan.teacherName} · {plan.trackType}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 font-display">
                {plan.className} Student Tracker
              </h1>
              <p className="mt-1.5 text-sm text-slate-600">
                Type your name to open your daily checklist. Tick your boxes each day and ask a
                parent to sign off with their surname.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleStartStudent(studentName, selectedGroup);
              }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="qr-student-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Student Full Name
                </label>
                <input
                  id="qr-student-name"
                  required
                  type="text"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="e.g. Amina Patel"
                  className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-slate-50 px-4 text-base text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                />
              </div>

              {plan.groups.length > 0 && (
                <div>
                  <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Select Your Group
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {plan.groups.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setSelectedGroup(g)}
                        className={`min-h-[44px] rounded-xl border px-3 text-sm font-medium transition-colors ${
                          selectedGroup === g
                            ? 'border-teal-700 bg-teal-50 text-teal-900'
                            : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full min-h-[48px] rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 transition-colors"
              >
                Start My Revision Checklist
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const firstName = tracker.studentName.trim().split(/\s+/)[0] || tracker.studentName;

  // Step 2: Kid-Friendly Student-Facing Interactive Revision Tracker
  return (
    <div className="min-h-screen bg-[#FAF8F3] pb-16">
      {/* Compact Sticky Top App Bar (<= 56px) */}
      <header className="sticky top-0 z-30 border-b border-amber-200/70 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2 min-w-0">
            {onExitToAdmin && (
              <button
                type="button"
                onClick={onExitToAdmin}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 shrink-0"
                aria-label="Back to Admin"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-900">
                {tracker.studentName} · {plan.className}
              </div>
              <div className="truncate text-[11px] text-slate-500">
                {plan.teacherName}
                {tracker.selectedGroup !== 'All' ? ` · ${tracker.selectedGroup}` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton variant="compact" />
            {(Boolean(onExitToAdmin) || !trackerId) && (
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem(`maktab-tracker-${plan.slug}`);
                  setTracker(null);
                }}
                className="min-h-[36px] rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
              >
                Switch Student
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pt-5 space-y-5">
        {/* Kid-Friendly Progress Summary & View Controls */}
        <section className="rounded-3xl border border-amber-200/80 bg-white p-5 sm:p-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                <Star className="h-4 w-4 fill-amber-400 text-amber-600" />
                <span>As-salamu alaykum, {firstName}</span>
              </div>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 font-display font-mono-tabular">
                {overallProgress.pct}% Complete
              </h1>
              <p className="mt-0.5 text-xs text-slate-600">{encouragementText}</p>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 font-mono-tabular">
              <div>
                <span className="font-bold text-teal-800">{overallProgress.done}</span> /{' '}
                {overallProgress.total} boxes ticked
              </div>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <div>
                <span className="font-bold text-amber-700">{signedDaysCount}</span> /{' '}
                {visibleScheduleDays.length} days signed
              </div>
            </div>
          </div>

          <div className="h-3.5 w-full overflow-hidden rounded-full bg-slate-100 border border-slate-200/70">
            <div
              className="h-full rounded-full bg-teal-700 transition-all duration-200"
              style={{ width: `${overallProgress.pct}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setTrackerView('weekly')}
                className={`min-h-[38px] rounded-lg px-3.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                  trackerView === 'weekly'
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Weekly Chart
              </button>
              <button
                type="button"
                onClick={() => setTrackerView('daily')}
                className={`min-h-[38px] rounded-lg px-3.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                  trackerView === 'daily'
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Day-by-Day Cards
              </button>
            </div>

            <label className="inline-flex min-h-[38px] items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={includeWeekends}
                onChange={(e) => setIncludeWeekends(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-teal-700"
              />
              Include Sat &amp; Sun
            </label>
          </div>
        </section>

        {/* MODE A: KID-FRIENDLY WEEKLY CHART WITH TICKBOXES & PARENT SURNAME SIGN-OFF */}
        {trackerView === 'weekly' && (
          <section className="space-y-4">
            {weekGroups.map((week) => (
              <div
                key={week.weekNumber}
                className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-slate-900">
                    {week.title}
                  </h2>
                  <span className="text-[11px] text-slate-500">
                    Tap a box to tick · Parent types surname on dotted line
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] border-collapse border border-slate-300 text-xs">
                    <thead>
                      <tr className="bg-amber-50/70 text-left">
                        <th className="w-28 border border-slate-300 px-2.5 py-2.5 font-bold text-slate-900">
                          DATE
                        </th>
                        <th className="w-28 border border-slate-300 px-2.5 py-2.5 font-bold text-slate-900">
                          SUBJECT
                        </th>
                        <th className="border border-slate-300 px-2.5 py-2.5 font-bold text-slate-900">
                          TODAY’S TARGET (TICK)
                        </th>
                        <th className="w-40 border border-slate-300 px-2.5 py-2.5 font-bold text-slate-900 text-center">
                          PARENT SIGN (SURNAME)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {week.days.map((day, idx) => {
                        const dayTasks = day.tasks.filter((t) => isTaskForTracker(t, tracker));
                        const rowBg = idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white';
                        const sig = tracker.parentSignaturesByDay?.[day.date];
                        const isEditingSig = signingDate === day.date;
                        if (dayTasks.length === 0) return null;

                        return dayTasks.map((task, tIdx) => {
                          const done = Boolean(tracker.completedTaskIds[task.id]);
                          return (
                            <tr key={task.id} className={rowBg}>
                              {tIdx === 0 && (
                                <td
                                  rowSpan={dayTasks.length}
                                  className="border border-slate-300 px-2.5 py-2.5 font-semibold text-slate-900 align-top"
                                >
                                  {formatOrdinalDate(day.date, { shortMonth: true })}
                                </td>
                              )}
                              <td className="border border-slate-300 px-2.5 py-2.5 font-medium text-slate-800 align-top">
                                {formatMobileSubject(task)}
                              </td>
                              <td className="border border-slate-300 p-0 align-top">
                                <button
                                  type="button"
                                  onClick={() => void handleToggleTask(task.id)}
                                  aria-pressed={done}
                                  className={`flex w-full min-h-[44px] items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                                    done ? 'bg-emerald-50/80' : 'hover:bg-amber-50/40'
                                  }`}
                                >
                                  <span
                                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition-colors ${
                                      done
                                        ? 'border-teal-700 bg-teal-700 text-white'
                                        : 'border-slate-400 bg-white text-transparent'
                                    }`}
                                  >
                                    <Check className="h-4 w-4 stroke-[2.75]" />
                                  </span>
                                  <span
                                    className={`text-xs sm:text-[13px] leading-snug ${
                                      done ? 'text-teal-900 line-through' : 'text-slate-900 font-medium'
                                    }`}
                                  >
                                    {task.detail}
                                  </span>
                                </button>
                              </td>

                              {tIdx === 0 && (
                                <td
                                  rowSpan={dayTasks.length}
                                  className="border border-slate-300 px-2.5 py-2 align-middle"
                                >
                                  {isEditingSig ? (
                                    <form
                                      onSubmit={(e) => {
                                        e.preventDefault();
                                        void handleSaveParentSignature(day.date, surnameInput);
                                      }}
                                      className="space-y-1.5"
                                    >
                                      <input
                                        type="text"
                                        autoFocus
                                        value={surnameInput}
                                        onChange={(e) => setSurnameInput(e.target.value)}
                                        placeholder="Parent surname..."
                                        className="w-full min-h-[36px] border-b-2 border-dotted border-teal-700 bg-transparent px-1 text-xs font-semibold text-slate-900 focus:outline-none"
                                      />
                                      <div className="flex items-center gap-1">
                                        <button
                                          type="submit"
                                          disabled={!surnameInput.trim()}
                                          className="flex-1 min-h-[32px] rounded-md bg-teal-700 px-2 text-[11px] font-semibold text-white hover:bg-teal-800 disabled:opacity-40"
                                        >
                                          Sign
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setSigningDate(null);
                                            setSurnameInput('');
                                          }}
                                          className="min-h-[32px] rounded-md border border-slate-200 px-2 text-[11px] text-slate-600 hover:bg-slate-100"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </form>
                                  ) : sig?.surname ? (
                                    <div className="flex flex-col items-center text-center gap-1">
                                      <div className="w-full border-b-2 border-dotted border-teal-700 pb-0.5 text-xs font-bold text-teal-800 italic">
                                        {sig.surname}
                                      </div>
                                      <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                        <span className="font-medium text-teal-800">Signed</span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setSigningDate(day.date);
                                            setSurnameInput(sig.surname);
                                          }}
                                          className="underline hover:text-slate-800"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handleSaveParentSignature(day.date, null)}
                                          className="underline hover:text-rose-700"
                                        >
                                          Clear
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex flex-col items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSigningDate(day.date);
                                          setSurnameInput(lastUsedParentSurname || '');
                                        }}
                                        className="flex w-full min-h-[40px] flex-col items-center justify-end pb-1 text-center group cursor-pointer"
                                      >
                                        <span className="w-full border-b-2 border-dotted border-slate-400 group-hover:border-teal-700 transition-colors" />
                                        <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 group-hover:text-teal-800">
                                          <PenLine className="h-3 w-3" />
                                          Tap to sign
                                        </span>
                                      </button>
                                      {lastUsedParentSurname && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void handleSaveParentSignature(
                                              day.date,
                                              lastUsedParentSurname
                                            )
                                          }
                                          className="rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-100 whitespace-nowrap"
                                        >
                                          Sign: {lastUsedParentSurname}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* MODE B: KID-FRIENDLY DAY-BY-DAY CARDS WITH BIG TICKBOXES & DOTTED PARENT SIGN LINE */}
        {trackerView === 'daily' && (
          <>
            <section className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Pick a Revision Day
                </h2>
                {activeDay && (
                  <span className="text-xs font-medium text-slate-600 font-mono-tabular">
                    Day {activeDay.dayIndex} · {includeWeekends ? 'All Days' : 'Mon–Fri'}
                  </span>
                )}
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {visibleScheduleDays.map((day) => {
                  const chip = formatDayChip(day.date);
                  const isSelected = activeDay?.date === day.date;
                  const dayTasks = day.tasks.filter((t) => isTaskForTracker(t, tracker));
                  const allDone =
                    dayTasks.length > 0 &&
                    dayTasks.every((t) => Boolean(tracker.completedTaskIds[t.id]));
                  const isSigned = Boolean(tracker.parentSignaturesByDay?.[day.date]?.surname);

                  return (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => {
                        setActiveDate(day.date);
                        setDayNote(tracker.notesByDay[day.date] || '');
                        setCardSurnameInput(
                          tracker.parentSignaturesByDay?.[day.date]?.surname || lastUsedParentSurname || ''
                        );
                      }}
                      className={`flex min-h-[66px] min-w-[64px] shrink-0 flex-col items-center justify-center rounded-2xl border px-3 py-2 transition-colors ${
                        isSelected
                          ? 'border-teal-700 bg-teal-700 text-white'
                          : allDone && isSigned
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                            : allDone
                              ? 'border-teal-300 bg-teal-50 text-teal-900'
                              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-[10px] font-medium opacity-80">{chip.dow}</span>
                      <span className="text-base font-bold font-mono-tabular">{chip.num}</span>
                      <span className="text-[10px] opacity-80">
                        {isSigned ? 'Signed' : allDone ? 'Done' : chip.month}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {activeDay && (
              <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 font-display">
                      Day {activeDay.dayIndex} Checklist
                    </h2>
                    <p className="text-xs text-slate-500 font-mono-tabular">
                      {activeDay.weekday}, {activeDay.date}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-teal-800 font-mono-tabular">
                    {activeDayTasks.filter((t) => tracker.completedTaskIds[t.id]).length}/
                    {activeDayTasks.length} ticked
                  </span>
                </div>

                {/* Big Kid-Friendly Tickboxes */}
                <div className="space-y-2">
                  {activeDayTasks.map((task) => {
                    const done = Boolean(tracker.completedTaskIds[task.id]);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => void handleToggleTask(task.id)}
                        aria-pressed={done}
                        className={`flex w-full min-h-[60px] items-start gap-3.5 rounded-2xl border p-3.5 text-left transition-colors ${
                          done
                            ? 'border-emerald-200 bg-emerald-50/70'
                            : 'border-slate-200 bg-white hover:bg-amber-50/40'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-colors ${
                            done
                              ? 'border-teal-700 bg-teal-700 text-white'
                              : 'border-slate-400 bg-white text-transparent'
                          }`}
                        >
                          <Check className="h-4 w-4 stroke-[2.75]" />
                        </span>

                        <div className="flex-1 min-w-0">
                          <div
                            className={`text-sm font-semibold ${
                              done ? 'text-teal-900 line-through' : 'text-slate-900'
                            }`}
                          >
                            {task.title}
                          </div>
                          <p
                            className={`mt-0.5 text-xs leading-relaxed ${
                              done ? 'text-teal-800/80' : 'text-slate-700'
                            }`}
                          >
                            {task.detail}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Parent Daily Dotted Sign Line (Online Surname Sign-Off) */}
                {(() => {
                  const activeSig = tracker.parentSignaturesByDay?.[activeDay.date];
                  return (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="card-parent-surname"
                          className="text-xs font-bold text-slate-900"
                        >
                          Parent Daily Sign-Off (Parent Surname)
                        </label>
                        {activeSig?.surname && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800">
                            <CheckCircle2 className="h-4 w-4" />
                            Signed by {activeSig.surname}
                          </span>
                        )}
                      </div>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleSaveParentSignature(activeDay.date, cardSurnameInput);
                        }}
                        className="flex flex-col gap-2.5 sm:flex-row sm:items-end"
                      >
                        <div className="flex-1">
                          <input
                            id="card-parent-surname"
                            type="text"
                            value={cardSurnameInput}
                            onChange={(e) => setCardSurnameInput(e.target.value)}
                            placeholder="Parent surname on dotted line..."
                            className="w-full min-h-[44px] border-b-2 border-dotted border-slate-600 bg-transparent px-2 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                          />
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            disabled={!cardSurnameInput.trim()}
                            className="min-h-[44px] rounded-xl bg-teal-700 px-4 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-40 whitespace-nowrap"
                          >
                            {activeSig?.surname ? 'Update Sign' : 'Sign Day'}
                          </button>
                          {activeSig?.surname && (
                            <button
                              type="button"
                              onClick={() => void handleSaveParentSignature(activeDay.date, null)}
                              className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </form>
                      {signSavedMsg && (
                        <p className="text-xs font-medium text-teal-800">{signSavedMsg}</p>
                      )}
                    </div>
                  );
                })()}

                <div className="border-t border-slate-100 pt-4 space-y-2">
                  <label
                    htmlFor="day-note-input"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Guardian Note / Tricky Ayahs to Revisit
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="day-note-input"
                      type="text"
                      value={dayNote}
                      onChange={(e) => setDayNote(e.target.value)}
                      placeholder="Optional parent note for teacher or tomorrow..."
                      className="flex-1 min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveNote()}
                      className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                    >
                      Save Note
                    </button>
                  </div>
                  {noteSavedMsg && (
                    <p className="text-xs font-medium text-teal-800">{noteSavedMsg}</p>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {/* Automated Daily Push Notification Settings */}
        <section className="rounded-3xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-800">
                {pushEnabled ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Automated Daily Push Reminders
                </h2>
                <p className="mt-0.5 text-xs text-slate-600">
                  Receive a daily phone notification listing {tracker.studentName}’s remaining
                  revision tasks.
                </p>
              </div>
            </div>
            {pushEnabled && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800 whitespace-nowrap">
                <CheckCircle2 className="h-4 w-4" />
                Active
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="push-time" className="block text-xs font-medium text-slate-600 mb-1">
                Daily Reminder Time ({browserTz})
              </label>
              <input
                id="push-time"
                type="time"
                value={reminderTime}
                onChange={(e) => void handleTimeChange(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono-tabular text-slate-900"
              />
            </div>

            <button
              type="button"
              disabled={pushBusy}
              onClick={() => void handleEnablePush()}
              className="min-h-[44px] rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {pushEnabled ? 'Update Push Subscription' : 'Enable Daily Reminders'}
            </button>

            <button
              type="button"
              disabled={pushBusy}
              onClick={() => void handleSendTestPush()}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
              Test Alert
            </button>
          </div>

          {pushStatus && (
            <p className="text-xs font-medium text-slate-700 bg-slate-50 rounded-xl p-3 border border-slate-200/70">
              {pushStatus}
            </p>
          )}
        </section>
      </main>
    </div>
  );
};
