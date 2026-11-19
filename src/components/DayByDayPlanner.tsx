import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  ClassPlan,
  DateRange,
  RevisionDay,
  RevisionTask,
  TaskCategory,
  TrackType,
} from '../shared/types.ts';
import { TeacherClassSelector } from './TeacherClassSelector.tsx';

interface DayByDayPlannerProps {
  plans: ClassPlan[];
  globalDateRange: DateRange;
  selectedPlanId: string;
  onSelectPlanId: (id: string) => void;
  includeWeekends: boolean;
  onToggleWeekends: (next: boolean) => void;
  onUpdateGlobalDateRange: (
    startDate: string,
    endDate: string,
    overwriteManual: boolean
  ) => Promise<void>;
  onSavePlan: (
    id: string,
    payload: Partial<ClassPlan> & { regenerateFromTeacherInput?: boolean }
  ) => Promise<void>;
  onAddPlan: (payload: Partial<ClassPlan>) => Promise<void>;
  onDeletePlan: (id: string) => Promise<void>;
}

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  quran: 'Quran / Qaidah',
  tajweed: 'Tajweed',
  surah: 'Surahs',
  'islamic-studies': 'Islamic Studies',
  duas: 'Duas & Names',
};

export const DayByDayPlanner: React.FC<DayByDayPlannerProps> = ({
  plans,
  globalDateRange,
  selectedPlanId,
  onSelectPlanId,
  includeWeekends,
  onToggleWeekends,
  onUpdateGlobalDateRange,
  onSavePlan,
  onAddPlan,
  onDeletePlan,
}) => {
  const [startInput, setStartInput] = useState(globalDateRange.startDate);
  const [endInput, setEndInput] = useState(globalDateRange.endDate);
  const [overwriteManual, setOverwriteManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    setStartInput(globalDateRange.startDate);
    setEndInput(globalDateRange.endDate);
  }, [globalDateRange.startDate, globalDateRange.endDate]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId]
  );

  const [draftDays, setDraftDays] = useState<RevisionDay[] | null>(null);
  const activeSchedule = draftDays ?? selectedPlan?.dailySchedule ?? [];

  // New task state
  const [addingForDate, setAddingForDate] = useState<string | null>(null);
  const [newTaskCategory, setNewTaskCategory] = useState<TaskCategory>('quran');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDetail, setNewTaskDetail] = useState('');
  const [newTaskGroup, setNewTaskGroup] = useState('');

  // Add class modal state
  const [newTeacher, setNewTeacher] = useState('');
  const [newClass, setNewClass] = useState('');
  const [newTrack, setNewTrack] = useState<TrackType>('Quran/Panj Para');
  const [newQuranTarget, setNewQuranTarget] = useState('');
  const [newTajweed, setNewTajweed] = useState('');
  const [newSurahs, setNewSurahs] = useState('');
  const [newIsNote, setNewIsNote] = useState('');
  const [newIsEnabled, setNewIsEnabled] = useState(true);

  const handlePlanSwitch = (id: string) => {
    setDraftDays(null);
    setAddingForDate(null);
    onSelectPlanId(id);
  };

  const applyGlobalRange = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      await onUpdateGlobalDateRange(startInput, endInput, overwriteManual);
      setDraftDays(null);
      setStatusMessage('Updated revision date range across active term plans.');
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleTaskFieldChange = (
    date: string,
    taskId: string,
    field: 'title' | 'detail' | 'category',
    value: string
  ) => {
    const base = draftDays ?? selectedPlan?.dailySchedule ?? [];
    const next = base.map((day) => {
      if (day.date !== date) return day;
      return {
        ...day,
        tasks: day.tasks.map((t) => (t.id === taskId ? { ...t, [field]: value } : t)),
      };
    });
    setDraftDays(next);
  };

  const handleRemoveTask = (date: string, taskId: string) => {
    const base = draftDays ?? selectedPlan?.dailySchedule ?? [];
    const next = base.map((day) => {
      if (day.date !== date) return day;
      return { ...day, tasks: day.tasks.filter((t) => t.id !== taskId) };
    });
    setDraftDays(next);
  };

  const handleConfirmAddTask = (date: string) => {
    if (!selectedPlan || !newTaskTitle.trim()) return;
    const base = draftDays ?? selectedPlan.dailySchedule;
    const next = base.map((day) => {
      if (day.date !== date) return day;
      const created: RevisionTask = {
        id: `${selectedPlan.slug}-d${day.dayIndex}-custom-${Date.now().toString(36)}`,
        category: newTaskCategory,
        title: newTaskTitle.trim(),
        detail: newTaskDetail.trim() || 'Follow teacher guidance',
        ...(newTaskGroup.trim() ? { group: newTaskGroup.trim() } : {}),
      };
      return { ...day, tasks: [...day.tasks, created] };
    });
    setDraftDays(next);
    setAddingForDate(null);
    setNewTaskTitle('');
    setNewTaskDetail('');
    setNewTaskGroup('');
  };

  const handleSaveSchedule = async () => {
    if (!selectedPlan || !draftDays) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      await onSavePlan(selectedPlan.id, {
        dailySchedule: draftDays,
        manuallyEdited: true,
      });
      setDraftDays(null);
      setStatusMessage(`Saved custom day-by-day schedule for ${selectedPlan.className}.`);
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = async () => {
    if (!selectedPlan) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      await onSavePlan(selectedPlan.id, {
        dateRange: { startDate: startInput, endDate: endInput },
        regenerateFromTeacherInput: true,
      });
      setDraftDays(null);
      setStatusMessage(
        `Regenerated ${selectedPlan.className} directly from ${selectedPlan.teacherName}’s input.`
      );
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeacher.trim() || !newClass.trim()) return;
    setBusy(true);
    try {
      await onAddPlan({
        teacherName: newTeacher.trim(),
        className: newClass.trim(),
        trackType: newTrack,
        dateRange: { startDate: startInput, endDate: endInput },
        targets: {
          quranOrQaidah: newQuranTarget.trim() || 'NA',
          tajweedMakhraj: newTajweed.trim() || 'NA',
          surahTargets: newSurahs.trim() || 'NA',
          quranDailyQuota: 'Daily target',
          surahDailyQuota: 'Daily target',
          islamicStudies: {
            enabled: newIsEnabled,
            fiqh: '',
            aqaaid: '',
            seerah: '',
            hadith: '',
            adaab: '',
            islamicHistory: '',
            akhlaaq: '',
            duas: '',
            revisionPlanNote: newIsNote.trim(),
          },
        },
      });
      setShowAddModal(false);
      setNewTeacher('');
      setNewClass('');
      setNewQuranTarget('');
      setNewTajweed('');
      setNewSurahs('');
      setNewIsNote('');
      setStatusMessage('Added new class and generated personalised study plan.');
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Day-by-Day Study Plan Editor
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Configure your custom ~2-week revision window and refine teacher-generated daily tasks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          <UserPlus className="h-4 w-4 text-teal-700" />
          Add Teacher / Class
        </button>
      </div>

      {/* Custom Date Range Controller */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label
                htmlFor="rev-start"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Revision Start Date
              </label>
              <input
                id="rev-start"
                type="date"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
                className="min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 font-mono-tabular focus:border-teal-700 focus:bg-white focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="rev-end" className="block text-xs font-medium text-slate-600 mb-1">
                Revision End Date
              </label>
              <input
                id="rev-end"
                type="date"
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
                className="min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 font-mono-tabular focus:border-teal-700 focus:bg-white focus:outline-none"
              />
            </div>
            <label className="inline-flex min-h-[40px] items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={overwriteManual}
                onChange={(e) => setOverwriteManual(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
              />
              Also reset manually edited classes
            </label>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void applyGlobalRange()}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Calendar className="h-3.5 w-3.5" />
            Apply Date Range to Classes
          </button>
        </div>

        {statusMessage && (
          <p className="mt-3 text-xs font-medium text-teal-800">{statusMessage}</p>
        )}
      </section>

      {selectedPlan && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column: Teacher + Class Sub-Selector & Teacher Input Reference */}
          <aside className="space-y-4 lg:col-span-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Select Teacher &amp; Class
              </div>
              <TeacherClassSelector
                plans={plans}
                selectedPlanId={selectedPlan.id}
                onSelectPlanId={handlePlanSwitch}
                allowAllTeachers={false}
                idPrefix="editor"
              />

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRegenerate()}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate from Teacher Input
                </button>
                {plans.length > 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onDeletePlan(selectedPlan.id)}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Original Teacher Input ({selectedPlan.teacherName})
              </h2>
              <div className="space-y-2.5 text-xs text-slate-700">
                <div>
                  <span className="font-semibold text-slate-900">Quran / Qaidah:</span>{' '}
                  {selectedPlan.targets.quranOrQaidah}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Daily Reading:</span>{' '}
                  {selectedPlan.targets.quranDailyQuota}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Surahs:</span>{' '}
                  <span className="whitespace-pre-line">{selectedPlan.targets.surahTargets}</span>
                </div>
                {selectedPlan.targets.islamicStudies.revisionPlanNote && (
                  <div className="border-t border-slate-100 pt-2">
                    <span className="font-semibold text-slate-900">Teacher Plan Notes:</span>
                    <p className="mt-1 whitespace-pre-line text-slate-600">
                      {selectedPlan.targets.islamicStudies.revisionPlanNote}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* Right Column: Day-by-Day Task Editor */}
          <div className="space-y-4 lg:col-span-8">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm font-semibold text-slate-900">
                  {selectedPlan.className} ·{' '}
                  {
                    activeSchedule.filter((day) => {
                      if (includeWeekends) return true;
                      const dow = new Date(`${day.date}T12:00:00Z`).getUTCDay();
                      return dow >= 1 && dow <= 5;
                    }).length
                  }{' '}
                  {includeWeekends ? 'Days' : 'Weekdays (Mon–Fri)'}
                </div>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeWeekends}
                    onChange={(e) => onToggleWeekends(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700"
                  />
                  Include Sat &amp; Sun
                </label>
              </div>
              <div className="flex items-center gap-2">
                {draftDays && (
                  <button
                    type="button"
                    onClick={() => setDraftDays(null)}
                    className="min-h-[38px] rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Discard Edits
                  </button>
                )}
                <button
                  type="button"
                  disabled={!draftDays || busy}
                  onClick={() => void handleSaveSchedule()}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-45"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save Day-by-Day Changes
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {activeSchedule
                .filter((day) => {
                  if (includeWeekends) return true;
                  const dow = new Date(`${day.date}T12:00:00Z`).getUTCDay();
                  return dow >= 1 && dow <= 5;
                })
                .map((day) => (
                <div
                  key={day.date}
                  className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-semibold text-teal-800 font-mono-tabular">
                        Day {day.dayIndex}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="text-sm font-semibold text-slate-900 font-mono-tabular">
                        {day.weekday}, {day.date}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAddingForDate(addingForDate === day.date ? null : day.date)
                      }
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Task
                    </button>
                  </div>

                  <div className="mt-3 space-y-2.5">
                    {day.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-start"
                      >
                        <select
                          aria-label="Task category"
                          value={task.category}
                          onChange={(e) =>
                            handleTaskFieldChange(day.date, task.id, 'category', e.target.value)
                          }
                          className="min-h-[36px] rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 focus:border-teal-700 focus:outline-none sm:w-36 shrink-0"
                        >
                          {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>

                        <div className="flex-1 space-y-1.5">
                          <input
                            type="text"
                            value={task.title}
                            onChange={(e) =>
                              handleTaskFieldChange(day.date, task.id, 'title', e.target.value)
                            }
                            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:border-teal-700 focus:outline-none"
                          />
                          <textarea
                            rows={2}
                            value={task.detail}
                            onChange={(e) =>
                              handleTaskFieldChange(day.date, task.id, 'detail', e.target.value)
                            }
                            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-teal-700 focus:outline-none"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveTask(day.date, task.id)}
                          className="self-end rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700 sm:self-start"
                          aria-label="Remove task"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}

                    {addingForDate === day.date && (
                      <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={newTaskCategory}
                            onChange={(e) => setNewTaskCategory(e.target.value as TaskCategory)}
                            className="min-h-[36px] rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                          >
                            {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            placeholder="Task title (e.g. Practice Surah Kahf)"
                            value={newTaskTitle}
                            onChange={(e) => setNewTaskTitle(e.target.value)}
                            className="flex-1 min-w-[180px] rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                          />
                          {selectedPlan.groups.length > 0 && (
                            <input
                              type="text"
                              placeholder="Group (optional)"
                              value={newTaskGroup}
                              onChange={(e) => setNewTaskGroup(e.target.value)}
                              className="w-28 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                            />
                          )}
                        </div>
                        <input
                          type="text"
                          placeholder="Details / pages / verses"
                          value={newTaskDetail}
                          onChange={(e) => setNewTaskDetail(e.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setAddingForDate(null)}
                            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfirmAddTask(day.date)}
                            className="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                          >
                            Add to Day {day.dayIndex}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add Teacher / Class Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold text-slate-900">Add Teacher & Class Plan</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateClass(e)} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Ustadh / Apa Name
                  </label>
                  <input
                    required
                    type="text"
                    value={newTeacher}
                    onChange={(e) => setNewTeacher(e.target.value)}
                    placeholder="e.g. Apa Aisha"
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Class Name
                  </label>
                  <input
                    required
                    type="text"
                    value={newClass}
                    onChange={(e) => setNewClass(e.target.value)}
                    placeholder="e.g. Year 6A"
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Track Type</label>
                <select
                  value={newTrack}
                  onChange={(e) => setNewTrack(e.target.value as TrackType)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                >
                  <option value="Quran/Panj Para">Quran/Panj Para</option>
                  <option value="Juzz 'Amma">Juzz 'Amma</option>
                  <option value="Qaidah">Qaidah</option>
                  <option value="Islamic Studies Only">Islamic Studies Only</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Quran / Qaidah Exam Targets
                </label>
                <input
                  type="text"
                  value={newQuranTarget}
                  onChange={(e) => setNewQuranTarget(e.target.value)}
                  placeholder="e.g. Page 12 to Page 40"
                  className="w-full min-h-[40px] rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tajweed & Makhraj
                  </label>
                  <input
                    type="text"
                    value={newTajweed}
                    onChange={(e) => setNewTajweed(e.target.value)}
                    placeholder="Ikhfa, Qalqalah, Madd"
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Surah Targets
                  </label>
                  <input
                    type="text"
                    value={newSurahs}
                    onChange={(e) => setNewSurahs(e.target.value)}
                    placeholder="Surah Naas to Duha"
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 pt-1">
                <input
                  type="checkbox"
                  checked={newIsEnabled}
                  onChange={(e) => setNewIsEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700"
                />
                Include Islamic Studies & Duas
              </label>

              {newIsEnabled && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Islamic Studies Revision Notes
                  </label>
                  <textarea
                    rows={2}
                    value={newIsNote}
                    onChange={(e) => setNewIsNote(e.target.value)}
                    placeholder="Topics, pages, or weekday revision instructions"
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="min-h-[40px] rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[40px] rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800"
                >
                  Generate Study Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
