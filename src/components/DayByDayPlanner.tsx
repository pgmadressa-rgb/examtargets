import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  ClassPlan,
  DateRange,
  RevisionDay,
  RevisionTask,
  TaskCategory,
  TrackType,
  TrackerSummary,
} from '../shared/types.ts';
import { createOrGetStudentTracker, toggleTrackerTask } from './ApiClient.ts';
import { TeacherClassSelector } from './TeacherClassSelector.tsx';

type EditTargetScope = 'class' | 'group' | 'student';

interface DayByDayPlannerProps {
  plans: ClassPlan[];
  trackersSummary: Record<string, TrackerSummary>;
  globalDateRange: DateRange;
  selectedPlanId: string;
  onSelectPlanId: (id: string) => void;
  includeWeekends: boolean;
  onToggleWeekends: (next: boolean) => void;
  onRefreshState: () => Promise<void>;
  onUpdateGlobalDateRange: (
    startDate: string,
    endDate: string,
    quranEndDate: string,
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
  trackersSummary,
  globalDateRange,
  selectedPlanId,
  onSelectPlanId,
  includeWeekends,
  onToggleWeekends,
  onRefreshState,
  onUpdateGlobalDateRange,
  onSavePlan,
  onAddPlan,
  onDeletePlan,
}) => {
  const [startInput, setStartInput] = useState(globalDateRange.startDate);
  const [quranEndInput, setQuranEndInput] = useState(
    globalDateRange.quranEndDate || globalDateRange.endDate
  );
  const [endInput, setEndInput] = useState(globalDateRange.endDate);
  const [overwriteManual, setOverwriteManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Target Scope Landing Mode: Whole Class (default) -> Groups -> Individual Students
  const [editScope, setEditScope] = useState<EditTargetScope>('class');
  const [activeGroupFilter, setActiveGroupFilter] = useState<string>('All');
  const [showBaselineInFilter, setShowBaselineInFilter] = useState(true);
  const [newGroupNameInput, setNewGroupNameInput] = useState('');
  const [activeStudentId, setActiveStudentId] = useState<string>('');
  const [newStudentNameInput, setNewStudentNameInput] = useState('');
  const [newStudentGroupInput, setNewStudentGroupInput] = useState('All');

  useEffect(() => {
    setStartInput(globalDateRange.startDate);
    setQuranEndInput(globalDateRange.quranEndDate || globalDateRange.endDate);
    setEndInput(globalDateRange.endDate);
  }, [globalDateRange.startDate, globalDateRange.quranEndDate, globalDateRange.endDate]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId]
  );

  const classStudents = useMemo(
    () => (selectedPlan ? trackersSummary[selectedPlan.id]?.students ?? [] : []),
    [selectedPlan, trackersSummary]
  );

  const selectedStudent = useMemo(
    () => classStudents.find((s) => s.id === activeStudentId) ?? classStudents[0] ?? null,
    [classStudents, activeStudentId]
  );

  useEffect(() => {
    if (!selectedPlan) return;
    setActiveGroupFilter((prev) =>
      prev !== 'All' && selectedPlan.groups.includes(prev)
        ? prev
        : selectedPlan.groups[0] ?? 'All'
    );
    setNewStudentGroupInput(selectedPlan.groups[0] ?? 'All');
  }, [selectedPlan?.id, selectedPlan?.groups]);

  useEffect(() => {
    if (classStudents.length === 0) {
      setActiveStudentId('');
    } else if (!classStudents.some((s) => s.id === activeStudentId)) {
      setActiveStudentId(classStudents[0].id);
    }
  }, [classStudents, activeStudentId]);

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
      await onUpdateGlobalDateRange(startInput, endInput, quranEndInput, overwriteManual);
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

  const handleTaskTargetChange = (date: string, taskId: string, targetValue: string) => {
    const base = draftDays ?? selectedPlan?.dailySchedule ?? [];
    const next = base.map((day) => {
      if (day.date !== date) return day;
      return {
        ...day,
        tasks: day.tasks.map((t) => {
          if (t.id !== taskId) return t;
          if (targetValue === 'class') {
            const { group: _g, studentTrackerId: _sid, studentName: _sn, ...rest } = t;
            return rest;
          }
          if (targetValue.startsWith('group:')) {
            const grp = targetValue.slice('group:'.length);
            const { studentTrackerId: _sid, studentName: _sn, ...rest } = t;
            return { ...rest, group: grp };
          }
          if (targetValue.startsWith('student:')) {
            const sid = targetValue.slice('student:'.length);
            const stu = classStudents.find((s) => s.id === sid);
            const { group: _g, ...rest } = t;
            return {
              ...rest,
              studentTrackerId: sid,
              studentName: stu?.studentName || t.studentName || 'Student',
            };
          }
          return t;
        }),
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

    const targetGroup =
      editScope === 'group' && activeGroupFilter !== 'All'
        ? activeGroupFilter
        : newTaskGroup.trim() || undefined;
    const targetStudent =
      editScope === 'student' && selectedStudent ? selectedStudent : null;

    const next = base.map((day) => {
      if (day.date !== date) return day;
      const created: RevisionTask = {
        id: `${selectedPlan.slug}-d${day.dayIndex}-custom-${Date.now().toString(36)}`,
        category: newTaskCategory,
        title: newTaskTitle.trim(),
        detail: newTaskDetail.trim() || 'Follow teacher guidance',
        ...(targetStudent
          ? {
              studentTrackerId: targetStudent.id,
              studentName: targetStudent.studentName,
            }
          : targetGroup
            ? { group: targetGroup }
            : {}),
      };
      return { ...day, tasks: [...day.tasks, created] };
    });
    setDraftDays(next);
    setAddingForDate(null);
    setNewTaskTitle('');
    setNewTaskDetail('');
    setNewTaskGroup('');
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan) return;
    const cleanGroup = newGroupNameInput.trim();
    if (!cleanGroup) return;
    if (selectedPlan.groups.some((g) => g.toLowerCase() === cleanGroup.toLowerCase())) {
      setActiveGroupFilter(cleanGroup);
      setNewGroupNameInput('');
      return;
    }
    setBusy(true);
    setStatusMessage(null);
    try {
      const nextGroups = [...selectedPlan.groups, cleanGroup];
      await onSavePlan(selectedPlan.id, { groups: nextGroups });
      setActiveGroupFilter(cleanGroup);
      setNewGroupNameInput('');
      setStatusMessage(`Created group "${cleanGroup}" for ${selectedPlan.className}.`);
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddStudentToClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan) return;
    const cleanName = newStudentNameInput.trim();
    if (!cleanName) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      const res = await createOrGetStudentTracker({
        classPlanId: selectedPlan.id,
        studentName: cleanName,
        selectedGroup: newStudentGroupInput || 'All',
      });
      await onRefreshState();
      setActiveStudentId(res.tracker.id);
      setNewStudentNameInput('');
      setStatusMessage(`Added "${res.tracker.studentName}" to ${selectedPlan.className}.`);
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleChangeStudentGroup = async (studentId: string, nextGroup: string) => {
    setBusy(true);
    setStatusMessage(null);
    try {
      await toggleTrackerTask(studentId, { selectedGroup: nextGroup });
      await onRefreshState();
      setStatusMessage(`Updated student’s group assignment to "${nextGroup}".`);
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
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
        dateRange: { startDate: startInput, endDate: endInput, quranEndDate: quranEndInput },
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
        dateRange: { startDate: startInput, endDate: endInput, quranEndDate: quranEndInput },
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
            Choose who you are editing for (Whole Class, Groups, or Individual Students) and refine
            daily revision tasks.
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

      {/* Landing Option: Editing Scope Selector (Whole Class -> Groups -> Students) */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Editing Target Scope
          </div>
          <span className="text-xs text-slate-500">
            Switch seamlessly between class-wide, group, or student-level plans
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <button
            type="button"
            onClick={() => setEditScope('class')}
            className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
              editScope === 'class'
                ? 'border-teal-700 bg-teal-50/70'
                : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
            }`}
          >
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                editScope === 'class' ? 'bg-teal-700 text-white' : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              <Users className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">Whole Class</div>
              <p className="mt-0.5 text-xs text-slate-600">
                Edit daily tasks shared by every student in the class.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setEditScope('group')}
            className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
              editScope === 'group'
                ? 'border-teal-700 bg-teal-50/70'
                : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
            }`}
          >
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                editScope === 'group' ? 'bg-teal-700 text-white' : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              <Layers className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">
                Groups{selectedPlan && selectedPlan.groups.length > 0 ? ` (${selectedPlan.groups.length})` : ''}
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                Create groups and tailor tasks for Group 1, Group 2, or ability tiers.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setEditScope('student')}
            className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
              editScope === 'student'
                ? 'border-teal-700 bg-teal-50/70'
                : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
            }`}
          >
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                editScope === 'student' ? 'bg-teal-700 text-white' : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">
                Individual Students ({classStudents.length})
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                Assign students to groups or add private student-specific tasks.
              </p>
            </div>
          </button>
        </div>

        {/* Group Scope Sub-Bar */}
        {selectedPlan && editScope === 'group' && (
          <div className="border-t border-slate-100 pt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveGroupFilter('All')}
                className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  activeGroupFilter === 'All'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                All Groups
              </button>
              {selectedPlan.groups.map((grp) => (
                <button
                  key={grp}
                  type="button"
                  onClick={() => setActiveGroupFilter(grp)}
                  className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                    activeGroupFilter === grp
                      ? 'border-teal-700 bg-teal-700 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {grp}
                </button>
              ))}

              <label className="inline-flex min-h-[36px] items-center gap-1.5 pl-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showBaselineInFilter}
                  onChange={(e) => setShowBaselineInFilter(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700"
                />
                Show Whole Class baseline tasks
              </label>
            </div>

            <form onSubmit={(e) => void handleCreateGroup(e)} className="flex items-center gap-2 shrink-0">
              <input
                type="text"
                value={newGroupNameInput}
                onChange={(e) => setNewGroupNameInput(e.target.value)}
                placeholder="New group name (e.g. Group 1)"
                className="min-h-[36px] w-48 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !newGroupNameInput.trim()}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Group
              </button>
            </form>
          </div>
        )}

        {/* Individual Student Scope Sub-Bar */}
        {selectedPlan && editScope === 'student' && (
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-wrap items-end gap-3 flex-1">
                {classStudents.length > 0 ? (
                  <>
                    <div className="min-w-[200px]">
                      <label
                        htmlFor="editor-student-select"
                        className="block text-xs font-medium text-slate-600 mb-1"
                      >
                        Editing Plan For Student
                      </label>
                      <select
                        id="editor-student-select"
                        value={selectedStudent?.id ?? ''}
                        onChange={(e) => setActiveStudentId(e.target.value)}
                        className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                      >
                        {classStudents.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.studentName} ({s.completionPct}% · {s.selectedGroup})
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedStudent && (
                      <div className="min-w-[160px]">
                        <label
                          htmlFor="editor-student-group"
                          className="block text-xs font-medium text-slate-600 mb-1"
                        >
                          Student’s Assigned Group
                        </label>
                        <select
                          id="editor-student-group"
                          disabled={busy}
                          value={selectedStudent.selectedGroup}
                          onChange={(e) =>
                            void handleChangeStudentGroup(selectedStudent.id, e.target.value)
                          }
                          className="w-full min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                        >
                          <option value="All">All (Whole Class)</option>
                          {selectedPlan.groups.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <label className="inline-flex min-h-[38px] items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showBaselineInFilter}
                        onChange={(e) => setShowBaselineInFilter(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700"
                      />
                      Show class &amp; group baseline tasks
                    </label>
                  </>
                ) : (
                  <p className="text-xs text-slate-600">
                    No tracked students in {selectedPlan.className} yet — add a student below to
                    assign a group or create student-specific daily tasks.
                  </p>
                )}
              </div>

              <form
                onSubmit={(e) => void handleAddStudentToClass(e)}
                className="flex flex-wrap items-end gap-2 shrink-0"
              >
                <div>
                  <label
                    htmlFor="editor-new-student-name"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Add Student to {selectedPlan.className}
                  </label>
                  <input
                    id="editor-new-student-name"
                    type="text"
                    value={newStudentNameInput}
                    onChange={(e) => setNewStudentNameInput(e.target.value)}
                    placeholder="Student full name"
                    className="min-h-[38px] w-44 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                  />
                </div>
                {selectedPlan.groups.length > 0 && (
                  <select
                    aria-label="New student group"
                    value={newStudentGroupInput}
                    onChange={(e) => setNewStudentGroupInput(e.target.value)}
                    className="min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-900"
                  >
                    <option value="All">All</option>
                    {selectedPlan.groups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="submit"
                  disabled={busy || !newStudentNameInput.trim()}
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-45 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Student
                </button>
              </form>
            </div>
          </div>
        )}
      </section>

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
              <label
                htmlFor="rev-quran-end"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Quran &amp; Surahs End
              </label>
              <input
                id="rev-quran-end"
                type="date"
                value={quranEndInput}
                onChange={(e) => setQuranEndInput(e.target.value)}
                className="min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 font-mono-tabular focus:border-teal-700 focus:bg-white focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="rev-end" className="block text-xs font-medium text-slate-600 mb-1">
                Islamic Studies &amp; Duas End
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
                .map((day) => {
                  const visibleTasks = day.tasks.filter((task) => {
                    if (editScope === 'class') {
                      return true;
                    }
                    if (editScope === 'group') {
                      if (task.studentTrackerId) return false;
                      if (activeGroupFilter === 'All') return true;
                      if (task.group === activeGroupFilter) return true;
                      return showBaselineInFilter && !task.group;
                    }
                    // editScope === 'student'
                    if (!selectedStudent) return !task.studentTrackerId;
                    if (task.studentTrackerId) {
                      return task.studentTrackerId === selectedStudent.id;
                    }
                    if (!showBaselineInFilter) return false;
                    return (
                      selectedStudent.selectedGroup === 'All' ||
                      !task.group ||
                      task.group === selectedStudent.selectedGroup
                    );
                  });

                  const addBtnLabel =
                    editScope === 'group' && activeGroupFilter !== 'All'
                      ? `Add for ${activeGroupFilter}`
                      : editScope === 'student' && selectedStudent
                        ? `Add for ${selectedStudent.studentName}`
                        : 'Add Task';

                  return (
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
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {addBtnLabel}
                        </button>
                      </div>

                      <div className="mt-3 space-y-2.5">
                        {visibleTasks.length === 0 && (
                          <p className="text-xs text-slate-400 italic py-1">
                            No tasks matching this scope for Day {day.dayIndex}. Click “{addBtnLabel}”
                            above to add one.
                          </p>
                        )}

                        {visibleTasks.map((task) => {
                          const targetValue = task.studentTrackerId
                            ? `student:${task.studentTrackerId}`
                            : task.group
                              ? `group:${task.group}`
                              : 'class';
                          return (
                            <div
                              key={task.id}
                              className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-start"
                            >
                              <div className="flex flex-col gap-1.5 sm:w-40 shrink-0">
                                <select
                                  aria-label="Task category"
                                  value={task.category}
                                  onChange={(e) =>
                                    handleTaskFieldChange(
                                      day.date,
                                      task.id,
                                      'category',
                                      e.target.value
                                    )
                                  }
                                  className="min-h-[36px] rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 focus:border-teal-700 focus:outline-none"
                                >
                                  {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                                    <option key={k} value={k}>
                                      {label}
                                    </option>
                                  ))}
                                </select>

                                <select
                                  aria-label="Task audience scope"
                                  value={targetValue}
                                  onChange={(e) =>
                                    handleTaskTargetChange(day.date, task.id, e.target.value)
                                  }
                                  className={`min-h-[32px] rounded-md border px-2 py-1 text-[11px] font-medium focus:border-teal-700 focus:outline-none ${
                                    task.studentTrackerId
                                      ? 'border-amber-300 bg-amber-50 text-amber-900'
                                      : task.group
                                        ? 'border-teal-300 bg-teal-50 text-teal-900'
                                        : 'border-slate-200 bg-white text-slate-600'
                                  }`}
                                >
                                  <option value="class">Whole Class</option>
                                  {selectedPlan.groups.map((grp) => (
                                    <option key={grp} value={`group:${grp}`}>
                                      Group: {grp}
                                    </option>
                                  ))}
                                  {classStudents.map((stu) => (
                                    <option key={stu.id} value={`student:${stu.id}`}>
                                      Student: {stu.studentName}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="flex-1 space-y-1.5">
                                <input
                                  type="text"
                                  value={task.title}
                                  onChange={(e) =>
                                    handleTaskFieldChange(
                                      day.date,
                                      task.id,
                                      'title',
                                      e.target.value
                                    )
                                  }
                                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:border-teal-700 focus:outline-none"
                                />
                                <textarea
                                  rows={2}
                                  value={task.detail}
                                  onChange={(e) =>
                                    handleTaskFieldChange(
                                      day.date,
                                      task.id,
                                      'detail',
                                      e.target.value
                                    )
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
                          );
                        })}

                        {addingForDate === day.date && (
                          <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 space-y-2">
                            <div className="text-[11px] font-semibold text-teal-900">
                              Adding for:{' '}
                              {editScope === 'student' && selectedStudent
                                ? `Student — ${selectedStudent.studentName} only`
                                : editScope === 'group' && activeGroupFilter !== 'All'
                                  ? `Group — ${activeGroupFilter}`
                                  : 'Whole Class'}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <select
                                value={newTaskCategory}
                                onChange={(e) =>
                                  setNewTaskCategory(e.target.value as TaskCategory)
                                }
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
                              {editScope === 'class' && selectedPlan.groups.length > 0 && (
                                <select
                                  value={newTaskGroup}
                                  onChange={(e) => setNewTaskGroup(e.target.value)}
                                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                                >
                                  <option value="">Whole Class</option>
                                  {selectedPlan.groups.map((grp) => (
                                    <option key={grp} value={grp}>
                                      {grp}
                                    </option>
                                  ))}
                                </select>
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
                  );
                })}
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
