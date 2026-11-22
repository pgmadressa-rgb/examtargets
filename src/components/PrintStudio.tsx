import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Calendar, Check, ExternalLink, Printer, QrCode, UserCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  formatOrdinalDate,
  groupDaysIntoWeeks,
  groupPlansByTeacher,
  isMeaningful,
  normalizeTeacherKey,
} from '../shared/planEngine.ts';
import {
  findLinkedSyllabusNote,
  getSyllabusNotesList,
} from '../shared/syllabus.ts';
import type {
  ClassPlan,
  DateRange,
  RevisionTask,
  StudentTracker,
  TrackerSummary,
} from '../shared/types.ts';
import { createOrGetStudentTracker } from './ApiClient.ts';
import { TeacherClassSelector } from './TeacherClassSelector.tsx';

export type SheetStyle = 'minimal' | 'detailed' | 'guide';

interface PrintStudioProps {
  plans: ClassPlan[];
  trackersSummary?: Record<string, TrackerSummary>;
  activeTermName: string;
  globalDateRange: DateRange;
  selectedPlanId: string;
  onSelectPlanId: (id: string) => void;
  includeWeekends: boolean;
  onToggleWeekends: (next: boolean) => void;
  sheetStyle: SheetStyle;
  onChangeSheetStyle: (style: SheetStyle) => void;
  onOpenSyllabusInput: (planId: string) => void;
  onOpenQrPreview: (slug: string, trackerId?: string) => void;
  onTrackerCreated: () => Promise<void>;
  onSavePlan: (
    id: string,
    payload: Partial<ClassPlan> & { regenerateFromTeacherInput?: boolean }
  ) => Promise<void>;
  onUpdateGlobalDateRange: (
    startDate: string,
    endDate: string,
    quranEndDate: string,
    overwriteManual: boolean
  ) => Promise<void>;
}

interface SheetItem {
  key: string;
  plan: ClassPlan;
  studentTracker?: StudentTracker;
  qrUrl: string;
}

function formatPrintDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function formatSubjectCell(task: RevisionTask, plan: ClassPlan): string {
  if (task.category === 'surah') return 'Surahs';
  if (task.category === 'quran') {
    if (plan.trackType === 'Qaidah') return 'Ahsanul Qawaaid';
    if (plan.trackType === "Juzz 'Amma") return "Juzz 'Amma";
    return 'Quran';
  }
  if (task.category === 'tajweed') return 'Tajweed';
  if (task.category === 'duas') return 'Duas';
  return task.title || 'Islamic Studies';
}

function getExamSubjectList(plan: ClassPlan): Array<{ label: string; value: string }> {
  const is = plan.targets.islamicStudies;
  const rows: Array<{ label: string; value: string }> = [];
  if (plan.trackType !== 'Islamic Studies Only') {
    if (isMeaningful(plan.targets.quranOrQaidah)) {
      rows.push({ label: `${plan.trackType} Target`, value: plan.targets.quranOrQaidah });
    }
    if (isMeaningful(plan.targets.quranDailyQuota)) {
      rows.push({ label: 'Daily Reading Quota', value: plan.targets.quranDailyQuota });
    }
    if (isMeaningful(plan.targets.tajweedMakhraj)) {
      rows.push({ label: 'Tajweed & Makhraj', value: plan.targets.tajweedMakhraj });
    }
    if (isMeaningful(plan.targets.surahTargets)) {
      rows.push({ label: 'Surah Targets', value: plan.targets.surahTargets });
    }
    if (isMeaningful(plan.targets.surahDailyQuota)) {
      rows.push({ label: 'Daily Surah Quota', value: plan.targets.surahDailyQuota });
    }
  }
  if (is.enabled) {
    const isSubjects: Array<[string, string]> = [
      ['Fiqh', is.fiqh],
      ['Aqaaid', is.aqaaid],
      ['Seerah', is.seerah],
      ['Hadith', is.hadith],
      ['Adaab', is.adaab],
      ['Islamic History', is.islamicHistory],
      ['Akhlaaq', is.akhlaaq],
      ['Duas & Names', is.duas],
    ];
    for (const [label, val] of isSubjects) {
      if (isMeaningful(val)) rows.push({ label, value: val });
    }
  }
  if (plan.targets.extraNotes && plan.targets.extraNotes.length > 0) {
    for (const extra of plan.targets.extraNotes) {
      rows.push({ label: extra.label, value: extra.value });
    }
  }
  return rows;
}

type RowTintOption = 'slate' | 'teal' | 'stone';
type PrintScope = 'single' | 'teacher' | 'all';

const ROW_TINT_CONFIG: Record<
  RowTintOption,
  {
    label: string;
    swatch: string;
    evenRowBg: string;
    evenDateBg: string;
    oddDateBg: string;
  }
> = {
  slate: {
    label: 'Cool Gray',
    swatch: '#CBD5E1',
    evenRowBg: '#E2E8F0',
    evenDateBg: '#CBD5E1',
    oddDateBg: '#F8FAFC',
  },
  teal: {
    label: 'Pale Teal',
    swatch: '#99F6E4',
    evenRowBg: '#CCFBF1',
    evenDateBg: '#99F6E4',
    oddDateBg: '#F8FAFC',
  },
  stone: {
    label: 'Warm Sand',
    swatch: '#E7D5B3',
    evenRowBg: '#F3E8D2',
    evenDateBg: '#E7D5B3',
    oddDateBg: '#FAF8F5',
  },
};

export const PrintStudio: React.FC<PrintStudioProps> = ({
  plans,
  trackersSummary,
  activeTermName,
  globalDateRange,
  selectedPlanId,
  onSelectPlanId,
  includeWeekends,
  onToggleWeekends,
  sheetStyle,
  onChangeSheetStyle,
  onOpenSyllabusInput,
  onOpenQrPreview,
  onTrackerCreated,
  onSavePlan,
  onUpdateGlobalDateRange,
}) => {
  const [scope, setScope] = useState<PrintScope>('single');
  const [qrMode, setQrMode] = useState<'class' | 'students'>('class');
  const [rowTint, setRowTint] = useState<RowTintOption>('slate');
  const [excludedSubjects, setExcludedSubjects] = useState<Record<string, boolean>>({});
  const [studentNamesInput, setStudentNamesInput] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('All');
  const [generatedTrackers, setGeneratedTrackers] = useState<StudentTracker[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId]
  );

  const enrolledStudents = useMemo(
    () => (selectedPlan ? trackersSummary?.[selectedPlan.id]?.students ?? [] : []),
    [selectedPlan, trackersSummary]
  );

  const [teacherNameDraft, setTeacherNameDraft] = useState(selectedPlan?.teacherName ?? '');
  const [classNameDraft, setClassNameDraft] = useState(selectedPlan?.className ?? '');
  const [startInput, setStartInput] = useState(globalDateRange.startDate);
  const [quranEndInput, setQuranEndInput] = useState(
    globalDateRange.quranEndDate || globalDateRange.endDate
  );
  const [endInput, setEndInput] = useState(globalDateRange.endDate);

  useEffect(() => {
    setTeacherNameDraft(selectedPlan?.teacherName ?? '');
    setClassNameDraft(selectedPlan?.className ?? '');
  }, [selectedPlan?.id, selectedPlan?.teacherName, selectedPlan?.className]);

  useEffect(() => {
    setStartInput(globalDateRange.startDate);
    setQuranEndInput(globalDateRange.quranEndDate || globalDateRange.endDate);
    setEndInput(globalDateRange.endDate);
  }, [globalDateRange.startDate, globalDateRange.quranEndDate, globalDateRange.endDate]);

  const selectedTeacherGroup = useMemo(() => {
    if (!selectedPlan) return null;
    const groups = groupPlansByTeacher(plans);
    const key = normalizeTeacherKey(selectedPlan.teacherName);
    return groups.find((g) => g.teacherKey === key) ?? null;
  }, [plans, selectedPlan]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const sheets: SheetItem[] = useMemo(() => {
    const withPrintDraft = (plan: ClassPlan): ClassPlan => {
      if (!selectedPlan) return plan;
      const cleanTeacher = teacherNameDraft.trim();
      const cleanClass = classNameDraft.trim();
      if (plan.id === selectedPlan.id) {
        return {
          ...plan,
          teacherName: cleanTeacher || plan.teacherName,
          className: cleanClass || plan.className,
        };
      }
      if (
        scope === 'teacher' &&
        cleanTeacher &&
        normalizeTeacherKey(plan.teacherName) === normalizeTeacherKey(selectedPlan.teacherName)
      ) {
        return {
          ...plan,
          teacherName: cleanTeacher,
        };
      }
      return plan;
    };

    if (qrMode === 'class') {
      if (scope === 'all') {
        return plans.map((plan) => ({
          key: plan.id,
          plan: withPrintDraft(plan),
          qrUrl: `${origin}/?track=${encodeURIComponent(plan.slug)}`,
        }));
      }
      if (scope === 'teacher' && selectedTeacherGroup) {
        return selectedTeacherGroup.plans.map((plan) => ({
          key: plan.id,
          plan: withPrintDraft(plan),
          qrUrl: `${origin}/?track=${encodeURIComponent(plan.slug)}`,
        }));
      }
    }
    if (!selectedPlan) return [];
    const previewPlan = withPrintDraft(selectedPlan);
    if (
      qrMode === 'students' &&
      generatedTrackers.length > 0 &&
      generatedTrackers[0].classPlanId === selectedPlan.id
    ) {
      return generatedTrackers.map((t) => ({
        key: t.id,
        plan: previewPlan,
        studentTracker: t,
        qrUrl: `${origin}/?tracker=${encodeURIComponent(t.id)}`,
      }));
    }
    return [
      {
        key: selectedPlan.id,
        plan: previewPlan,
        qrUrl: `${origin}/?track=${encodeURIComponent(selectedPlan.slug)}`,
      },
    ];
  }, [
    scope,
    qrMode,
    plans,
    selectedTeacherGroup,
    selectedPlan,
    generatedTrackers,
    origin,
    teacherNameDraft,
    classNameDraft,
  ]);

  const handleSavePrePrintNames = async (applyToAllTeacherClasses = false) => {
    if (!selectedPlan) return;
    const nextTeacher = teacherNameDraft.trim();
    const nextClass = classNameDraft.trim();
    if (!nextTeacher || !nextClass) {
      setMessage('Teacher name and class name cannot be empty.');
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      if (applyToAllTeacherClasses && selectedTeacherGroup && selectedTeacherGroup.plans.length > 1) {
        for (const p of selectedTeacherGroup.plans) {
          await onSavePlan(p.id, {
            teacherName: nextTeacher,
            className: p.id === selectedPlan.id ? nextClass : p.className,
          });
        }
        setMessage(
          `Saved "${nextTeacher}" across all ${selectedTeacherGroup.plans.length} classes.`
        );
      } else {
        await onSavePlan(selectedPlan.id, {
          teacherName: nextTeacher,
          className: nextClass,
        });
        setMessage(`Saved pre-print header: ${nextTeacher} (${nextClass}).`);
      }
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleApplyPrintDates = async () => {
    if (!startInput || !endInput || !quranEndInput) return;
    setBusy(true);
    setMessage(null);
    try {
      await onUpdateGlobalDateRange(startInput, endInput, quranEndInput, false);
      setMessage(
        `Updated printout dates: Start ${startInput} · Quran ${quranEndInput} · IS/Duas ${endInput}.`
      );
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchQrMode = (nextMode: 'class' | 'students') => {
    setQrMode(nextMode);
    if (nextMode === 'students') {
      setScope('single');
      setMessage(
        generatedTrackers.length > 0
          ? `Showing ${generatedTrackers.length} individual student QR sheet(s).`
          : 'Enter or select student names below to generate individual QR handouts.'
      );
    } else {
      setMessage('Whole Class QR enabled — parents scan one class QR and enter their child’s name.');
    }
  };

  const handleAppendEnrolledStudent = (name: string) => {
    const existing = studentNamesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (existing.some((n) => n.toLowerCase() === name.toLowerCase())) return;
    setStudentNamesInput([...existing, name].join(', '));
  };

  const handleGeneratePersonalSheets = async () => {
    if (!selectedPlan) return;
    const names = studentNamesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) {
      setGeneratedTrackers([]);
      setMessage('Enter at least one student name to generate Individual Student QRs.');
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const created: StudentTracker[] = [];
      for (const name of names) {
        const res = await createOrGetStudentTracker({
          classPlanId: selectedPlan.id,
          studentName: name,
          selectedGroup:
            selectedGroup !== 'All' ? selectedGroup : selectedPlan.groups[0] ?? 'All',
        });
        created.push(res.tracker);
      }
      setGeneratedTrackers(created);
      setQrMode('students');
      setScope('single');
      await onTrackerCreated();
      setMessage(
        `Generated ${created.length} individual student QR handout${created.length > 1 ? 's' : ''} for ${selectedPlan.className}.`
      );
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Screen-Only Controls */}
      <section className="no-print space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Parent Printout &amp; QR Handout Studio
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Switch between the simplistic Week 1 / Week 2 Timetable and Detailed Targets sheets
              with alternating row shading and scannable QR codes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="h-4 w-4" />
            Print {sheets.length} Sheet{sheets.length > 1 ? 's' : ''}
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          {/* Row 1: Print Scope + Sheet Style + Weekday Toggle */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <span className="block text-xs font-medium text-slate-600 mb-1">Sheet Style</span>
                <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    aria-pressed={sheetStyle === 'minimal'}
                    onClick={() => onChangeSheetStyle('minimal')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      sheetStyle === 'minimal'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Minimal Timetable
                  </button>
                  <button
                    type="button"
                    aria-pressed={sheetStyle === 'detailed'}
                    onClick={() => onChangeSheetStyle('detailed')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      sheetStyle === 'detailed'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Detailed Targets Sheet
                  </button>
                  <button
                    type="button"
                    aria-pressed={sheetStyle === 'guide'}
                    onClick={() => onChangeSheetStyle('guide')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      sheetStyle === 'guide'
                        ? 'bg-teal-700 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Detailed Revision Guide
                  </button>
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-600 mb-1">Print Scope</span>
                <div className="inline-flex rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setScope('single')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      scope === 'single' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Single Class
                  </button>
                  {selectedTeacherGroup && selectedTeacherGroup.plans.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setScope('teacher')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        scope === 'teacher'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Teacher ({selectedTeacherGroup.plans.length} Classes)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setScope('all')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      scope === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    All {plans.length} Classes
                  </button>
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-600 mb-1">
                  Days Included
                </span>
                <div className="inline-flex rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => onToggleWeekends(false)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      !includeWeekends ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Mon–Fri Only
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleWeekends(true)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      includeWeekends ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    + Sat &amp; Sun
                  </button>
                </div>
              </div>
            </div>

            {scope === 'single' && selectedPlan && (
              <button
                type="button"
                onClick={() =>
                  onOpenQrPreview(
                    selectedPlan.slug,
                    qrMode === 'students' ? generatedTrackers[0]?.id : undefined
                  )
                }
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <QrCode className="h-4 w-4 text-teal-700" />
                Preview Online QR Tracker
                <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
              </button>
            )}
          </div>

          {/* Row 2: Teacher -> Class Sub-Selector + Row Shading Controls */}
          <div className="border-t border-slate-100 pt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            {scope !== 'all' && selectedPlan ? (
              <TeacherClassSelector
                plans={plans}
                selectedPlanId={selectedPlan.id}
                onSelectPlanId={(id) => {
                  setGeneratedTrackers([]);
                  onSelectPlanId(id);
                }}
                allowAllTeachers={false}
                idPrefix="print"
              />
            ) : (
              <div className="text-xs text-slate-500">
                Printing all {plans.length} classes across all teachers in the active term.
              </div>
            )}

            <div>
              <span className="block text-xs font-medium text-slate-600 mb-1">
                Printout Date Row Shading
              </span>
              <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-100 p-1">
                {(Object.keys(ROW_TINT_CONFIG) as RowTintOption[]).map((key) => {
                  const active = rowTint === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setRowTint(key)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 rounded-xs border border-slate-400 shrink-0"
                        style={{ backgroundColor: ROW_TINT_CONFIG[key].swatch }}
                      />
                      {ROW_TINT_CONFIG[key].label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Row 3: Pre-Printing Field Edits (Teacher Name, Class Name & Revision Dates) */}
          {selectedPlan && (
            <div className="border-t border-slate-100 pt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              {scope !== 'all' && (
                <div className="flex flex-wrap items-end gap-3 flex-1">
                  <div className="min-w-[190px] flex-1 max-w-xs">
                    <label
                      htmlFor="print-teacher-name-edit"
                      className="block text-xs font-medium text-slate-600 mb-1"
                    >
                      Teacher Name (Pre-Print Edit)
                    </label>
                    <input
                      id="print-teacher-name-edit"
                      type="text"
                      value={teacherNameDraft}
                      onChange={(e) => setTeacherNameDraft(e.target.value)}
                      placeholder="e.g. Apa Faiza"
                      className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div className="min-w-[150px] flex-1 max-w-[220px]">
                    <label
                      htmlFor="print-class-name-edit"
                      className="block text-xs font-medium text-slate-600 mb-1"
                    >
                      Class Title (Pre-Print Edit)
                    </label>
                    <input
                      id="print-class-name-edit"
                      type="text"
                      value={classNameDraft}
                      onChange={(e) => setClassNameDraft(e.target.value)}
                      placeholder="e.g. Year 1A"
                      className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={
                      busy ||
                      (teacherNameDraft.trim() === selectedPlan.teacherName &&
                        classNameDraft.trim() === selectedPlan.className)
                    }
                    onClick={() => void handleSavePrePrintNames(false)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save Name
                  </button>

                  {selectedTeacherGroup && selectedTeacherGroup.plans.length > 1 && (
                    <button
                      type="button"
                      disabled={busy || teacherNameDraft.trim() === selectedPlan.teacherName}
                      onClick={() => void handleSavePrePrintNames(true)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Apply to All {selectedTeacherGroup.plans.length} Classes
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-end gap-2.5 shrink-0">
                <div>
                  <label
                    htmlFor="print-start-date"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Start Date
                  </label>
                  <input
                    id="print-start-date"
                    type="date"
                    value={startInput}
                    onChange={(e) => setStartInput(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-mono-tabular text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="print-quran-end-date"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Quran / Surahs End
                  </label>
                  <input
                    id="print-quran-end-date"
                    type="date"
                    value={quranEndInput}
                    onChange={(e) => setQuranEndInput(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-mono-tabular text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="print-end-date"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    IS / Duas End
                  </label>
                  <input
                    id="print-end-date"
                    type="date"
                    value={endInput}
                    onChange={(e) => setEndInput(e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-mono-tabular text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={
                    busy ||
                    (startInput === globalDateRange.startDate &&
                      quranEndInput === (globalDateRange.quranEndDate || globalDateRange.endDate) &&
                      endInput === globalDateRange.endDate)
                  }
                  onClick={() => void handleApplyPrintDates()}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Calendar className="h-3.5 w-3.5 text-teal-700" />
                  Update Dates
                </button>
              </div>
            </div>
          )}

          {/* Row 4: QR Code Generation Toggles (Whole Class Default ON + Separate Individual Students Toggle) */}
          {selectedPlan && (
            <div className="border-t border-slate-100 pt-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={qrMode === 'class'}
                  onClick={() =>
                    handleSwitchQrMode(qrMode === 'class' ? 'students' : 'class')
                  }
                  className={`flex items-center justify-between gap-4 rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                    qrMode === 'class'
                      ? 'border-teal-700 bg-teal-50/60'
                      : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900">
                      Whole Class QR (Default)
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      Single class QR code per handout — locked to that class only.
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      qrMode === 'class' ? 'bg-teal-700' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        qrMode === 'class' ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </span>
                </button>

                <button
                  type="button"
                  role="switch"
                  aria-checked={qrMode === 'students'}
                  onClick={() =>
                    handleSwitchQrMode(qrMode === 'students' ? 'class' : 'students')
                  }
                  className={`flex items-center justify-between gap-4 rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                    qrMode === 'students'
                      ? 'border-teal-700 bg-teal-50/60'
                      : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900">
                      Individual Students QR
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      Print separate personal QR sheets locked to each student.
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      qrMode === 'students' ? 'bg-teal-700' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        qrMode === 'students' ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </span>
                </button>
              </div>

              {qrMode === 'students' && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                  {enrolledStudents.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-slate-600">
                        Enrolled in {selectedPlan.className}:
                      </span>
                      {enrolledStudents.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleAppendEnrolledStudent(s.studentName)}
                          className="min-h-[30px] rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-teal-700 hover:text-teal-800 whitespace-nowrap"
                        >
                          + {s.studentName}
                          {s.selectedGroup !== 'All' ? ` (${s.selectedGroup})` : ''}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setStudentNamesInput(
                            enrolledStudents.map((s) => s.studentName).join(', ')
                          )
                        }
                        className="min-h-[30px] rounded-md border border-teal-700/30 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100 whitespace-nowrap"
                      >
                        Select All ({enrolledStudents.length})
                      </button>
                    </div>
                  )}

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <label
                        htmlFor="student-roster-input"
                        className="block text-xs font-medium text-slate-600 mb-1"
                      >
                        Student Names for Individual QR Sheets (comma-separated)
                      </label>
                      <input
                        id="student-roster-input"
                        type="text"
                        value={studentNamesInput}
                        onChange={(e) => setStudentNamesInput(e.target.value)}
                        placeholder="e.g. Amina Patel, Yusuf Khan"
                        className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                      />
                    </div>

                    {selectedPlan.groups.length > 0 && (
                      <div>
                        <label
                          htmlFor="print-group-select"
                          className="block text-xs font-medium text-slate-600 mb-1"
                        >
                          Group
                        </label>
                        <select
                          id="print-group-select"
                          value={selectedGroup}
                          onChange={(e) => setSelectedGroup(e.target.value)}
                          className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900"
                        >
                          <option value="All">All Groups</option>
                          {selectedPlan.groups.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={busy || !studentNamesInput.trim()}
                      onClick={() => void handleGeneratePersonalSheets()}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <UserCheck className="h-4 w-4" />
                      Generate Student QR Sheets
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Row 5: Linked Syllabus Notes Selector for Detailed Revision Guide */}
          {selectedPlan && sheetStyle === 'guide' && (
            <div className="border-t border-slate-100 pt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                  <BookOpen className="h-3.5 w-3.5 text-teal-700" />
                  <span>
                    Linked Syllabus Notes ({getSyllabusNotesList(selectedPlan).length} subjects saved
                    for {selectedPlan.className})
                  </span>
                </div>
                {getSyllabusNotesList(selectedPlan).length > 0 ? (
                  <div className="flex flex-wrap items-center gap-3">
                    {getSyllabusNotesList(selectedPlan).map((entry) => {
                      const key = `${selectedPlan.id}::${entry.subject}`;
                      const checked = !excludedSubjects[key];
                      return (
                        <label
                          key={entry.subject}
                          className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setExcludedSubjects((prev) => ({
                                ...prev,
                                [key]: !e.target.checked,
                              }))
                            }
                            className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700"
                          />
                          <span>{entry.subject}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    No syllabus notes saved for {selectedPlan.className} yet. Add text or upload
                    an Excel/Sheets file in Admin Panel to link subject notes here.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => onOpenSyllabusInput(selectedPlan.id)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <BookOpen className="h-3.5 w-3.5 text-teal-700" />
                {getSyllabusNotesList(selectedPlan).length > 0
                  ? 'Edit Syllabus Notes'
                  : 'Add Syllabus Notes'}
              </button>
            </div>
          )}

          {message && <p className="text-xs font-medium text-teal-800">{message}</p>}
        </div>
      </section>

      {/* Empty Term State */}
      {plans.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-base font-semibold text-slate-900">No class plans in active term</p>
          <p className="mt-1 text-sm text-slate-500">
            Upload a CSV, add a class in Day-by-Day, or load a saved term above to print handouts.
          </p>
        </div>
      )}

      {/* Printable Handout Sheets */}
      <div className="space-y-8">
        {sheets.map((sheet) => {
          const groupFilter = sheet.studentTracker?.selectedGroup;
          const tint = ROW_TINT_CONFIG[rowTint];

          if (sheetStyle === 'minimal') {
            const weeks = groupDaysIntoWeeks(sheet.plan.dailySchedule, includeWeekends);
            return (
              <article
                key={sheet.key}
                className="print-sheet mx-auto max-w-[820px] rounded-xl border border-slate-300 bg-white p-6 sm:p-10 text-slate-950 shadow-xs"
              >
                {/* Minimal Centered Title Header + Compact Corner QR */}
                <header className="relative flex flex-col items-center text-center pb-5 sm:pr-28">
                  <h2 className="text-xl font-bold uppercase tracking-wide text-slate-950 font-display">
                    REVISION WEEK TIMETABLE
                  </h2>
                  <p className="mt-1.5 text-lg font-bold text-slate-950">
                    {sheet.plan.className} – {activeTermName || 'Exam Revision 2026'}
                    {sheet.studentTracker ? ` (${sheet.studentTracker.studentName})` : ''}
                  </p>
                  <p className="mt-1.5 text-sm font-bold uppercase tracking-wide text-slate-950">
                    {sheet.plan.teacherName}
                    {groupFilter && groupFilter !== 'All' ? ` · ${groupFilter}` : ''}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-slate-700 font-mono-tabular">
                    {formatPrintDate(sheet.plan.dateRange.startDate)} –{' '}
                    {formatPrintDate(sheet.plan.dateRange.endDate)}
                    {sheet.plan.trackType !== 'Islamic Studies Only' &&
                    sheet.plan.dateRange.quranEndDate &&
                    sheet.plan.dateRange.quranEndDate < sheet.plan.dateRange.endDate
                      ? ` · Quran/Surahs end ${formatPrintDate(sheet.plan.dateRange.quranEndDate)}`
                      : ''}
                  </p>
                  {!sheet.studentTracker && (
                    <p className="mt-2 text-xs font-medium text-slate-800">
                      Student Name:{' '}
                      <span className="inline-block w-52 border-b-[1.5px] border-dotted border-slate-700 align-bottom" />
                    </p>
                  )}

                  <div className="mt-4 sm:mt-0 sm:absolute sm:right-0 sm:top-0 flex flex-col items-center rounded-lg border border-slate-900 bg-white p-1.5 text-center">
                    <QRCodeSVG
                      value={sheet.qrUrl}
                      size={68}
                      level="M"
                      bgColor="#FFFFFF"
                      fgColor="#000000"
                    />
                    <span className="mt-1 text-[9px] font-bold leading-tight text-slate-950">
                      Scan to Track
                    </span>
                  </div>
                </header>

                <p className="mb-3 text-center text-[11px] font-medium text-slate-700">
                  Tick each box once revised · Ask a parent to sign on the dotted line each day
                </p>

                {/* Week 1 / Week 2 Kid-Friendly 4-Column Tables with Tickbox & Daily Parent Sign */}
                <div className="space-y-6">
                  {weeks.map((week) => (
                    <section key={week.weekNumber} className="print-avoid-break space-y-2.5">
                      <h3 className="text-center text-xs font-bold uppercase tracking-wide text-slate-950">
                        {week.title}
                      </h3>

                      <table className="w-full border-collapse border border-slate-950 text-xs sm:text-[13px]">
                        <thead>
                          <tr
                            className="text-left"
                            style={{
                              backgroundColor: tint.evenDateBg,
                              WebkitPrintColorAdjust: 'exact',
                              printColorAdjust: 'exact',
                            }}
                          >
                            <th className="w-32 border border-slate-950 px-2.5 py-2 font-bold uppercase">
                              TARGET DATE
                            </th>
                            <th className="w-36 border border-slate-950 px-2.5 py-2 font-bold uppercase">
                              SUBJECT
                            </th>
                            <th className="border border-slate-950 px-2.5 py-2 font-bold uppercase">
                              TARGET
                            </th>
                            <th className="w-32 border border-slate-950 px-2.5 py-2 font-bold uppercase text-center">
                              PARENT SIGN
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {week.days.map((day, dayIdx) => {
                            const dayTasks = day.tasks.filter((t) => {
                              if (t.studentTrackerId) {
                                return Boolean(
                                  sheet.studentTracker &&
                                    t.studentTrackerId === sheet.studentTracker.id
                                );
                              }
                              return (
                                !groupFilter ||
                                groupFilter === 'All' ||
                                !t.group ||
                                t.group === groupFilter
                              );
                            });
                            const isAlt = dayIdx % 2 === 1;
                            const rowBgColor = isAlt ? tint.evenRowBg : '#FFFFFF';
                            const dateBgColor = isAlt ? tint.evenDateBg : tint.oddDateBg;
                            const cellStyle = {
                              backgroundColor: rowBgColor,
                              WebkitPrintColorAdjust: 'exact' as const,
                              printColorAdjust: 'exact' as const,
                            };
                            const dateStyle = {
                              backgroundColor: dateBgColor,
                              WebkitPrintColorAdjust: 'exact' as const,
                              printColorAdjust: 'exact' as const,
                            };

                            const parentSignCell = (rowSpan: number) => (
                              <td
                                rowSpan={rowSpan}
                                className="border border-slate-950 px-2.5 py-2 align-bottom text-center"
                                style={cellStyle}
                              >
                                <div className="flex min-h-[34px] flex-col justify-end">
                                  <div className="w-full border-b-[1.5px] border-dotted border-slate-700" />
                                  <span className="mt-0.5 text-[9px] font-medium text-slate-500">
                                    Sign
                                  </span>
                                </div>
                              </td>
                            );

                            if (dayTasks.length === 0) {
                              return (
                                <tr key={day.date} style={cellStyle}>
                                  <td
                                    className="border border-slate-950 px-2.5 py-2 font-medium align-top"
                                    style={dateStyle}
                                  >
                                    {formatOrdinalDate(day.date, { shortMonth: true })}
                                  </td>
                                  <td className="border border-slate-950 px-2.5 py-2" style={cellStyle}>
                                    Revision
                                  </td>
                                  <td className="border border-slate-950 px-2.5 py-2" style={cellStyle}>
                                    <div className="flex items-start gap-2">
                                      <span
                                        aria-hidden="true"
                                        className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-[3px] border-[1.5px] border-slate-950 bg-white"
                                      />
                                      <span>Consolidate covered topics</span>
                                    </div>
                                  </td>
                                  {parentSignCell(1)}
                                </tr>
                              );
                            }

                            return dayTasks.map((task, taskIdx) => (
                              <tr key={task.id} style={cellStyle}>
                                {taskIdx === 0 && (
                                  <td
                                    rowSpan={dayTasks.length}
                                    className="border border-slate-950 px-2.5 py-2 font-medium align-top"
                                    style={dateStyle}
                                  >
                                    {formatOrdinalDate(day.date, { shortMonth: true })}
                                  </td>
                                )}
                                <td
                                  className="border border-slate-950 px-2.5 py-2 font-medium align-top"
                                  style={cellStyle}
                                >
                                  {formatSubjectCell(task, sheet.plan)}
                                </td>
                                <td
                                  className="border border-slate-950 px-2.5 py-2 align-top"
                                  style={cellStyle}
                                >
                                  <div className="flex items-start gap-2">
                                    <span
                                      aria-hidden="true"
                                      className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-[3px] border-[1.5px] border-slate-950 bg-white"
                                    />
                                    <span>{task.detail}</span>
                                  </div>
                                </td>
                                {taskIdx === 0 && parentSignCell(dayTasks.length)}
                              </tr>
                            ));
                          })}
                        </tbody>
                      </table>
                    </section>
                  ))}
                </div>

                <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600">
                  <span>
                    Online tracker:{' '}
                    <span className="font-mono-tabular underline">{sheet.qrUrl}</span>
                  </span>
                  <span>Scan QR to tick tasks on phone &amp; sign with parent surname.</span>
                </footer>
              </article>
            );
          }

          // Detailed Targets Sheet OR Detailed Revision Guide (with Linked Syllabus Notes)
          const examTargets = getExamSubjectList(sheet.plan);
          const linkedNotes =
            sheetStyle === 'guide'
              ? getSyllabusNotesList(sheet.plan).filter(
                  (entry) => !excludedSubjects[`${sheet.plan.id}::${entry.subject}`]
                )
              : [];
          const visibleDays = includeWeekends
            ? sheet.plan.dailySchedule
            : sheet.plan.dailySchedule.filter((d) => {
                const dow = new Date(`${d.date}T12:00:00Z`).getUTCDay();
                return dow >= 1 && dow <= 5;
              });

          return (
            <article
              key={sheet.key}
              className="print-sheet mx-auto max-w-[820px] rounded-xl border border-slate-300 bg-white p-6 sm:p-8 text-slate-950 shadow-xs"
            >
              {/* Sheet Header with QR Code */}
              <header className="flex items-start justify-between gap-6 border-b-2 border-slate-900 pb-4">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    {sheetStyle === 'guide'
                      ? `Detailed Revision Guide & Tracker · ${activeTermName || 'Exam Term'}`
                      : 'Exam Revision Handout · Parent & Student Copy'}
                  </div>
                  <h2 className="text-2xl font-bold text-slate-950">
                    {sheet.plan.className}
                    {sheet.studentTracker ? ` — ${sheet.studentTracker.studentName}` : ''}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700">
                    <span>
                      <strong>Teacher:</strong> {sheet.plan.teacherName}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      <strong>Track:</strong> {sheet.plan.trackType}
                    </span>
                    {groupFilter && groupFilter !== 'All' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          <strong>Group:</strong> {groupFilter}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">
                      <strong>Window:</strong> {formatPrintDate(sheet.plan.dateRange.startDate)} –{' '}
                      {formatPrintDate(sheet.plan.dateRange.endDate)}
                      {sheet.plan.trackType !== 'Islamic Studies Only' &&
                      sheet.plan.dateRange.quranEndDate &&
                      sheet.plan.dateRange.quranEndDate < sheet.plan.dateRange.endDate
                        ? ` · Quran/Surahs end ${formatPrintDate(sheet.plan.dateRange.quranEndDate)}`
                        : ''}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-center rounded-lg border border-slate-900 p-2 text-center">
                  <QRCodeSVG value={sheet.qrUrl} size={86} level="M" bgColor="#FFFFFF" fgColor="#000000" />
                  <span className="mt-1.5 text-[10px] font-bold leading-tight text-slate-950">
                    Scan to Track Online
                  </span>
                  <span className="text-[9px] text-slate-600">&amp; Daily Push Alerts</span>
                </div>
              </header>

              {!sheet.studentTracker && (
                <div className="mt-3 flex items-center justify-between gap-6 border-b border-slate-300 pb-2.5 text-xs">
                  <div className="flex-1">
                    <strong>Student Name:</strong>{' '}
                    <span className="inline-block w-52 border-b border-slate-500" />
                  </div>
                  <div>
                    <strong>Daily Study Goal:</strong>{' '}
                    <span className="inline-block w-32 border-b border-slate-500" />
                  </div>
                </div>
              )}

              {/* Section 1: Exam Targets */}
              <section className="mt-4 print-avoid-break">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  1. Exam Targets Summary
                </h3>
                <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 border border-slate-900 p-3 sm:grid-cols-2 text-xs">
                  {examTargets.map((item) => (
                    <div key={item.label} className="leading-snug">
                      <span className="font-bold text-slate-950">{item.label}:</span>{' '}
                      <span className="text-slate-800 whitespace-pre-line">{item.value}</span>
                    </div>
                  ))}
                  {isMeaningful(sheet.plan.targets.islamicStudies.revisionPlanNote) && (
                    <div className="sm:col-span-2 mt-1 border-t border-slate-300 pt-1.5 leading-snug">
                      <span className="font-bold text-slate-950">Teacher Note:</span>{' '}
                      <span className="text-slate-800 whitespace-pre-line">
                        {sheet.plan.targets.islamicStudies.revisionPlanNote}
                      </span>
                    </div>
                  )}
                </div>
              </section>

              {/* Section 2 (Detailed Revision Guide Mode): Linked Syllabus Notes per Subject */}
              {sheetStyle === 'guide' && (
                <section className="mt-4 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                      2. Subject Syllabus Revision Guide ({linkedNotes.length} Subject
                      {linkedNotes.length === 1 ? '' : 's'})
                    </h3>
                    <span className="text-[10px] text-slate-600">
                      Tick each subject box once syllabus notes are reviewed
                    </span>
                  </div>

                  {linkedNotes.length > 0 ? (
                    <div className="border border-slate-900 divide-y divide-slate-900">
                      {linkedNotes.map((entry, idx) => (
                        <div
                          key={entry.subject}
                          className="print-avoid-break p-3 text-xs space-y-1.5"
                          style={{
                            backgroundColor: idx % 2 === 1 ? tint.evenRowBg : '#FFFFFF',
                            WebkitPrintColorAdjust: 'exact',
                            printColorAdjust: 'exact',
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-bold text-slate-950 uppercase tracking-wide">
                              {entry.subject}
                            </div>
                            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-800">
                              <span
                                aria-hidden="true"
                                className="inline-block h-3.5 w-3.5 rounded-[3px] border-[1.5px] border-slate-950 bg-white"
                              />
                              <span>Notes Reviewed</span>
                            </div>
                          </div>
                          <p className="text-slate-900 leading-relaxed whitespace-pre-line">
                            {entry.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="border border-dashed border-slate-400 p-3 text-xs text-slate-600 no-print">
                      No saved syllabus notes are linked for {sheet.plan.className} yet. Add text
                      or upload an Excel/Sheets file in Admin Panel to populate this Revision Guide.
                    </div>
                  )}
                </section>
              )}

              {/* Section 2 or 3: Day-by-Day Revision Tracker Table with Alternating Light Backgrounds */}
              <section className="mt-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    {sheetStyle === 'guide' ? '3.' : '2.'} Daily Revision Checklist (
                    {visibleDays.length} {includeWeekends ? 'Days' : 'Weekdays'})
                  </h3>
                  <span className="text-[10px] text-slate-600">
                    Tick each box once revised · Parent signs on the dotted line daily
                  </span>
                </div>

                <table className="mt-2 w-full border-collapse border border-slate-900 text-xs">
                  <thead>
                    <tr className="bg-slate-200/80 text-left">
                      <th className="w-28 border border-slate-900 px-2.5 py-1.5 font-bold">Date</th>
                      <th className="border border-slate-900 px-2.5 py-1.5 font-bold">
                        Daily Revision Tasks
                      </th>
                      <th className="w-32 border border-slate-900 px-2.5 py-1.5 font-bold text-center">
                        Parent Sign
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDays.map((day, idx) => {
                      const dayTasks = day.tasks.filter((t) => {
                        if (t.studentTrackerId) {
                          return Boolean(
                            sheet.studentTracker && t.studentTrackerId === sheet.studentTracker.id
                          );
                        }
                        return (
                          !groupFilter ||
                          groupFilter === 'All' ||
                          !t.group ||
                          t.group === groupFilter
                        );
                      });
                      const isAlt = idx % 2 === 1;
                      const rowBgColor = isAlt ? tint.evenRowBg : '#FFFFFF';
                      const dateBgColor = isAlt ? tint.evenDateBg : tint.oddDateBg;
                      const cellStyle = {
                        backgroundColor: rowBgColor,
                        WebkitPrintColorAdjust: 'exact' as const,
                        printColorAdjust: 'exact' as const,
                      };
                      const dateStyle = {
                        backgroundColor: dateBgColor,
                        WebkitPrintColorAdjust: 'exact' as const,
                        printColorAdjust: 'exact' as const,
                      };
                      return (
                        <tr key={day.date} className="print-avoid-break align-top" style={cellStyle}>
                          <td
                            className="border border-slate-900 px-2.5 py-2 font-mono-tabular font-semibold whitespace-nowrap"
                            style={dateStyle}
                          >
                            <div>Day {day.dayIndex}</div>
                            <div className="text-[11px] font-medium text-slate-800">
                              {formatPrintDate(day.date)}
                            </div>
                          </td>
                          <td className="border border-slate-900 px-2.5 py-2" style={cellStyle}>
                            <ul className="space-y-1.5">
                              {dayTasks.map((task) => {
                                const linkedNote =
                                  sheetStyle === 'guide'
                                    ? findLinkedSyllabusNote(sheet.plan, task.category, task.title)
                                    : null;
                                const isNoteLinked =
                                  linkedNote &&
                                  !excludedSubjects[`${sheet.plan.id}::${linkedNote.subject}`];
                                return (
                                  <li key={task.id} className="flex items-start gap-2 leading-snug">
                                    <span
                                      aria-hidden="true"
                                      className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-[3px] border-[1.5px] border-slate-950 bg-white"
                                    />
                                    <span>
                                      <strong className="text-slate-950">{task.title}:</strong>{' '}
                                      <span className="text-slate-800">{task.detail}</span>
                                      {isNoteLinked && (
                                        <span className="ml-1.5 text-[10px] font-semibold text-teal-900">
                                          (See {linkedNote.subject} Guide)
                                        </span>
                                      )}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </td>
                          <td
                            className="border border-slate-900 px-2.5 py-2 align-bottom text-center"
                            style={cellStyle}
                          >
                            <div className="flex min-h-[36px] flex-col justify-end">
                              <div className="w-full border-b-[1.5px] border-dotted border-slate-700" />
                              <span className="mt-0.5 text-[9px] font-medium text-slate-500">
                                Sign
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>

              <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600">
                <span>
                  Online tracker link:{' '}
                  <span className="font-mono-tabular underline">{sheet.qrUrl}</span>
                </span>
                <span>Scan QR to check off tasks on your phone &amp; sign with parent surname.</span>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
};
