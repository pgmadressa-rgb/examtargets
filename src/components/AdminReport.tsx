import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  ExternalLink,
  Printer,
  QrCode,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { isMeaningful, normalizeTeacherKey } from '../shared/planEngine.ts';
import type {
  ClassPlan,
  DateRange,
  TrackType,
  TrackerSummary,
} from '../shared/types.ts';
import { TeacherClassSelector } from './TeacherClassSelector.tsx';

interface AdminReportProps {
  plans: ClassPlan[];
  trackersSummary: Record<string, TrackerSummary>;
  globalDateRange: DateRange;
  skippedNonNovCount: number;
  selectedPlanId: string;
  onSelectPlanId: (id: string) => void;
  includeWeekends: boolean;
  onToggleWeekends: (next: boolean) => void;
  onOpenDayEditor: (planId: string) => void;
  onOpenPrintSheet: (planId: string) => void;
  onOpenQrPreview: (slug: string, trackerId?: string) => void;
}

const TRACK_FILTERS: Array<'All' | TrackType> = [
  'All',
  'Quran/Panj Para',
  "Juzz 'Amma",
  'Qaidah',
  'Islamic Studies Only',
];

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export const AdminReport: React.FC<AdminReportProps> = ({
  plans,
  trackersSummary,
  globalDateRange,
  skippedNonNovCount,
  selectedPlanId,
  onSelectPlanId,
  includeWeekends,
  onToggleWeekends,
  onOpenDayEditor,
  onOpenPrintSheet,
  onOpenQrPreview,
}) => {
  const [search, setSearch] = useState('');
  const [trackFilter, setTrackFilter] = useState<'All' | TrackType>('All');
  const [selectedTeacherKey, setSelectedTeacherKey] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'focus' | 'directory'>('focus');

  const filteredPlans = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter((p) => {
      if (
        selectedTeacherKey !== 'all' &&
        normalizeTeacherKey(p.teacherName) !== selectedTeacherKey
      ) {
        return false;
      }
      if (trackFilter !== 'All' && p.trackType !== trackFilter) return false;
      if (!q) return true;
      return (
        p.teacherName.toLowerCase().includes(q) ||
        p.className.toLowerCase().includes(q) ||
        p.trackType.toLowerCase().includes(q) ||
        p.targets.quranOrQaidah.toLowerCase().includes(q) ||
        p.targets.surahTargets.toLowerCase().includes(q)
      );
    });
  }, [plans, search, trackFilter, selectedTeacherKey]);

  const activeIndex = useMemo(() => {
    const idx = filteredPlans.findIndex((p) => p.id === selectedPlanId);
    return idx >= 0 ? idx : 0;
  }, [filteredPlans, selectedPlanId]);

  const activePlan = filteredPlans[activeIndex] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewMode !== 'focus' || filteredPlans.length === 0) return;
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'SELECT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.key === 'ArrowRight') {
        const next = filteredPlans[(activeIndex + 1) % filteredPlans.length];
        if (next) onSelectPlanId(next.id);
      } else if (e.key === 'ArrowLeft') {
        const prev =
          filteredPlans[(activeIndex - 1 + filteredPlans.length) % filteredPlans.length];
        if (prev) onSelectPlanId(prev.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, filteredPlans, activeIndex, onSelectPlanId]);

  const stats = useMemo(() => {
    const totalTrackers = Object.values(trackersSummary).reduce(
      (sum, s) => sum + s.trackerCount,
      0
    );
    const activeClasses = Object.values(trackersSummary).filter((s) => s.trackerCount > 0);
    const avgPct =
      activeClasses.length > 0
        ? Math.round(
            activeClasses.reduce((sum, s) => sum + s.averageCompletionPct, 0) /
              activeClasses.length
          )
        : 0;
    const totalDays = plans[0]?.dailySchedule.length ?? 14;
    return { totalTrackers, avgPct, totalDays };
  }, [plans, trackersSummary]);

  const activeSummary = activePlan ? trackersSummary[activePlan.id] : undefined;

  const subjectRows = useMemo(() => {
    if (!activePlan) return [];
    const is = activePlan.targets.islamicStudies;
    if (!is.enabled) return [];
    const list: Array<{ label: string; value: string }> = [
      { label: 'Fiqh', value: is.fiqh },
      { label: 'Aqaaid', value: is.aqaaid },
      { label: 'Seerah', value: is.seerah },
      { label: 'Hadith', value: is.hadith },
      { label: 'Adaab', value: is.adaab },
      { label: 'Islamic History', value: is.islamicHistory },
      { label: 'Akhlaaq', value: is.akhlaaq },
      { label: 'Duas', value: is.duas },
    ];
    return list.filter((item) => isMeaningful(item.value));
  }, [activePlan]);

  return (
    <div className="space-y-6">
      {/* Calm Header & Summary Strip */}
      <section className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium text-teal-800">
              November 2026 Exam Cycle · {skippedNonNovCount} earlier entries filtered out
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Admin Revision Report
            </h1>
          </div>
          <p className="text-sm text-slate-600 max-w-xl">
            Structured one class at a time to reduce visual clutter. Switch between Focus Mode and
            Class Directory below.
          </p>
        </div>

        {/* 4-Column Tabular Metrics Strip */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">November 2026 Classes</div>
            <div className="mt-1.5 text-2xl font-bold text-slate-900 font-mono-tabular">
              {plans.length}
            </div>
            <div className="mt-1 text-xs text-slate-500">Ready for parent handouts</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">Revision Window</div>
            <div className="mt-1.5 text-2xl font-bold text-slate-900 font-mono-tabular">
              {stats.totalDays} Days
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono-tabular">
              {formatShortDate(globalDateRange.startDate)} – {formatShortDate(globalDateRange.endDate)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">Active QR Trackers</div>
            <div className="mt-1.5 text-2xl font-bold text-slate-900 font-mono-tabular">
              {stats.totalTrackers}
            </div>
            <div className="mt-1 text-xs text-slate-500">Synced student sessions</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">Average Progress</div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-teal-800 font-mono-tabular">
                {stats.avgPct}%
              </span>
              <span className="text-xs text-slate-500">across active students</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-teal-700 transition-all duration-200"
                style={{ width: `${stats.avgPct}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Workspace Filter Toolbar */}
      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find teacher, class, or surah..."
              className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {TRACK_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setTrackFilter(f)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  trackFilter === f
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 self-start lg:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('focus')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'focus'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Focus Card
          </button>
          <button
            type="button"
            onClick={() => setViewMode('directory')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'directory'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Class Directory
          </button>
        </div>
      </section>

      {/* Empty States */}
      {plans.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-base font-semibold text-slate-900">Active term has no class plans</p>
          <p className="mt-1 text-sm text-slate-500">
            Upload a new CSV spreadsheet, load a saved term above, or add classes in Day-by-Day.
          </p>
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-base font-semibold text-slate-900">No matching classes</p>
          <p className="mt-1 text-sm text-slate-500">
            Clear your search filter or upload a new CSV batch.
          </p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setTrackFilter('All');
                setSelectedTeacherKey('all');
              }}
              className="mt-4 inline-flex min-h-[40px] items-center rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              Reset Filters
            </button>
        </div>
      ) : null}

      {/* MODE 1: ADHD-FRIENDLY FOCUS CARD */}
      {viewMode === 'focus' && activePlan && (
        <section className="space-y-4">
          {/* Calm Stepper & Teacher -> Class Sub-Selector Bar */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const prev =
                    filteredPlans[
                      (activeIndex - 1 + filteredPlans.length) % filteredPlans.length
                    ];
                  if (prev) onSelectPlanId(prev.id);
                }}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Previous
              </button>

              <span className="text-xs font-medium text-slate-500 font-mono-tabular whitespace-nowrap">
                Class {activeIndex + 1} of {filteredPlans.length}
              </span>

              <button
                type="button"
                onClick={() => {
                  const next = filteredPlans[(activeIndex + 1) % filteredPlans.length];
                  if (next) onSelectPlanId(next.id);
                }}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <TeacherClassSelector
              plans={plans}
              selectedPlanId={activePlan.id}
              onSelectPlanId={onSelectPlanId}
              selectedTeacherKey={selectedTeacherKey}
              onSelectTeacherKey={setSelectedTeacherKey}
              allowAllTeachers={true}
              idPrefix="report"
              compact={true}
            />
          </div>

          {/* Single Spacious Focus Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                  <span>{activePlan.teacherName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activePlan.trackType}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular">Submitted {activePlan.timestamp}</span>
                  {activePlan.manuallyEdited && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-700">Customised Plan</span>
                    </>
                  )}
                </div>
                <h2 className="mt-1.5 text-2xl font-bold text-slate-900">
                  {activePlan.className}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onOpenDayEditor(activePlan.id)}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Edit Daily Plan
                </button>
                <button
                  type="button"
                  onClick={() => onOpenQrPreview(activePlan.slug)}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <QrCode className="h-3.5 w-3.5 text-teal-700" />
                  Open Parent QR View
                </button>
                <button
                  type="button"
                  onClick={() => onOpenPrintSheet(activePlan.id)}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Handout
                </button>
              </div>
            </div>

            {/* 4 Clear Subject Chunks — Zero NA Clutter */}
            <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
              {activePlan.trackType !== 'Islamic Studies Only' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      01. Quran / Qaidah Target
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-900 whitespace-pre-line">
                      {isMeaningful(activePlan.targets.quranOrQaidah)
                        ? activePlan.targets.quranOrQaidah
                        : 'No reading target specified'}
                    </p>
                    {isMeaningful(activePlan.targets.quranDailyQuota) && (
                      <p className="mt-2 text-xs font-medium text-teal-800">
                        Daily Target: {activePlan.targets.quranDailyQuota}
                      </p>
                    )}
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      02. Tajweed & Makhraj Covered
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-800 whitespace-pre-line">
                      {isMeaningful(activePlan.targets.tajweedMakhraj)
                        ? activePlan.targets.tajweedMakhraj
                        : 'Applied during daily recitation'}
                    </p>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      03. Surah Memorisation Targets
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-800 whitespace-pre-line">
                      {isMeaningful(activePlan.targets.surahTargets)
                        ? activePlan.targets.surahTargets
                        : 'No specific surah list entered'}
                    </p>
                    {isMeaningful(activePlan.targets.surahDailyQuota) && (
                      <p className="mt-2 text-xs font-medium text-teal-800">
                        Daily Surah Quota: {activePlan.targets.surahDailyQuota}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div
                className={
                  activePlan.trackType === 'Islamic Studies Only'
                    ? 'md:col-span-2 space-y-4'
                    : 'space-y-4'
                }
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {activePlan.trackType === 'Islamic Studies Only'
                      ? '01. Islamic Studies & Duas Breakdown'
                      : '04. Islamic Studies & Duas'}
                  </h3>
                  <span className="text-xs font-medium text-slate-500">
                    {activePlan.targets.islamicStudies.enabled
                      ? `${subjectRows.length} active subjects`
                      : 'Not taught in this class'}
                  </span>
                </div>

                {activePlan.targets.islamicStudies.enabled ? (
                  <>
                    {subjectRows.length > 0 ? (
                      <dl className="divide-y divide-slate-100 border-t border-b border-slate-100">
                        {subjectRows.map((row) => (
                          <div key={row.label} className="grid grid-cols-3 gap-3 py-2.5">
                            <dt className="text-xs font-semibold text-slate-700">{row.label}</dt>
                            <dd className="col-span-2 text-sm text-slate-800 whitespace-pre-line">
                              {row.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-sm text-slate-600">
                        Islamic Studies marked Yes; awaiting page targets from teacher.
                      </p>
                    )}

                    {isMeaningful(activePlan.targets.islamicStudies.revisionPlanNote) && (
                      <div className="rounded-xl bg-slate-50 p-4 border border-slate-200/70">
                        <div className="text-xs font-semibold text-slate-700">
                          Teacher’s Revision Guidance
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed text-slate-700 whitespace-pre-line">
                          {activePlan.targets.islamicStudies.revisionPlanNote}
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-slate-500">
                    This class covers Quran / Tajweed / Surahs only for the November 2026 cycle.
                  </p>
                )}

                {activePlan.targets.extraNotes && activePlan.targets.extraNotes.length > 0 && (
                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-200/70 space-y-1.5">
                    <div className="text-xs font-semibold text-slate-700">
                      Additional Spreadsheet Fields
                    </div>
                    {activePlan.targets.extraNotes.map((item) => (
                      <div key={item.label} className="text-xs text-slate-700">
                        <span className="font-semibold text-slate-900">{item.label}:</span>{' '}
                        <span className="whitespace-pre-line">{item.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Schedule Snapshot + Live Student QR Sync */}
            <div className="mt-8 grid grid-cols-1 gap-6 border-t border-slate-200 pt-6 lg:grid-cols-2">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Generated Schedule Preview ({includeWeekends ? 'All 7 Days' : 'Mon–Fri Weekdays'})
                  </h3>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeWeekends}
                        onChange={(e) => onToggleWeekends(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700"
                      />
                      Include Sat &amp; Sun
                    </label>
                    <span className="text-xs text-slate-500 font-mono-tabular">
                      {formatShortDate(activePlan.dateRange.startDate)} –{' '}
                      {formatShortDate(activePlan.dateRange.endDate)}
                    </span>
                  </div>
                </div>
                <div className="mt-3 divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {activePlan.dailySchedule
                    .filter((day) => {
                      if (includeWeekends) return true;
                      const dow = new Date(`${day.date}T12:00:00Z`).getUTCDay();
                      return dow >= 1 && dow <= 5;
                    })
                    .slice(0, 5)
                    .map((day) => (
                      <div key={day.date} className="flex items-start gap-3 px-4 py-3 bg-white">
                        <div className="w-20 shrink-0 text-xs font-medium text-slate-500 font-mono-tabular">
                          {day.weekday} {formatShortDate(day.date)}
                        </div>
                        <div className="flex-1 text-xs text-slate-700 space-y-1">
                          {day.tasks.map((t) => (
                            <div key={t.id}>
                              <span className="font-semibold text-slate-900">{t.title}:</span>{' '}
                              <span>{t.detail}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenDayEditor(activePlan.id)}
                  className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-teal-800 hover:underline"
                >
                  <Calendar className="h-3.5 w-3.5" />
                  View or edit all {activePlan.dailySchedule.length} days
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Live Guardian & Student Progress
                  </h3>
                  <span className="text-xs font-medium text-slate-500 font-mono-tabular">
                    {activeSummary?.trackerCount ?? 0} linked students
                  </span>
                </div>

                {activeSummary && activeSummary.students.length > 0 ? (
                  <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                    {activeSummary.students.map((student) => (
                      <div
                        key={student.id}
                        className="flex items-center justify-between gap-4 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                            <span className="truncate">{student.studentName}</span>
                            {student.selectedGroup !== 'All' && (
                              <span className="text-xs font-normal text-slate-500">
                                · {student.selectedGroup}
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 flex items-center gap-3">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-teal-700"
                                style={{ width: `${student.completionPct}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium text-slate-700 font-mono-tabular">
                              {student.completedCount}/{student.totalTasks} ({student.completionPct}
                              %)
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenQrPreview(activePlan.slug, student.id)}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          Open
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5">
                    <p className="text-sm font-medium text-slate-800">
                      No parents have scanned this QR code yet
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      Print the parent handout or open the QR view to test checking off daily tasks.
                      Progress syncs automatically here.
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenQrPreview(activePlan.slug)}
                      className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      Test QR Tracker
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* MODE 2: CLASS DIRECTORY GRID */}
      {viewMode === 'directory' && filteredPlans.length > 0 && (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredPlans.map((plan) => {
            const summary = trackersSummary[plan.id];
            const pct = summary?.averageCompletionPct ?? 0;
            return (
              <article
                key={plan.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="truncate font-medium text-slate-700">{plan.teacherName}</span>
                    <span className="shrink-0">{plan.trackType}</span>
                  </div>
                  <h3 className="mt-1 text-lg font-bold text-slate-900">{plan.className}</h3>

                  <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                    {isMeaningful(plan.targets.quranOrQaidah) && (
                      <p className="line-clamp-2">
                        <span className="font-semibold text-slate-800">Quran/Qaidah:</span>{' '}
                        {plan.targets.quranOrQaidah}
                      </p>
                    )}
                    {isMeaningful(plan.targets.surahTargets) && (
                      <p className="line-clamp-2">
                        <span className="font-semibold text-slate-800">Surahs:</span>{' '}
                        {plan.targets.surahTargets}
                      </p>
                    )}
                    {plan.targets.islamicStudies.enabled && (
                      <p className="line-clamp-2">
                        <span className="font-semibold text-slate-800">Islamic Studies:</span>{' '}
                        {plan.targets.islamicStudies.revisionPlanNote ||
                          plan.targets.islamicStudies.fiqh ||
                          'Included in daily plan'}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-5 border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-mono-tabular">
                    <span>{summary?.trackerCount ?? 0} trackers</span>
                    <span>{pct}% avg</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-teal-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectPlanId(plan.id);
                        setViewMode('focus');
                      }}
                      className="flex-1 min-h-[38px] rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      Focus View
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenPrintSheet(plan.id)}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      Print
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
};
