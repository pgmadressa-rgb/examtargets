/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BookmarkCheck, FolderOpen, Printer, Trash2, X } from 'lucide-react';
import {
  addClassPlan,
  bulkSaveSyllabusNotes,
  clearActiveTerm,
  deleteClassPlan,
  deleteTermSnapshot,
  fetchAppState,
  loadTermSnapshot,
  resetSeedPlans,
  savePlanSyllabusNotes,
  saveTermSnapshot,
  updateClassPlan,
  updateGlobalDateRange,
  uploadCsvPlans,
} from './components/ApiClient.ts';
import type { AppStateResponse } from './components/ApiClient.ts';
import { MobileQrTracker } from './components/MobileQrTracker.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import { DEFAULT_DATE_RANGE } from './shared/planEngine.ts';

const AdminReport = lazy(() =>
  import('./components/AdminReport.tsx').then((m) => ({ default: m.AdminReport }))
);
const DayByDayPlanner = lazy(() =>
  import('./components/DayByDayPlanner.tsx').then((m) => ({ default: m.DayByDayPlanner }))
);
const PrintStudio = lazy(() =>
  import('./components/PrintStudio.tsx').then((m) => ({ default: m.PrintStudio }))
);
const CsvUploadView = lazy(() =>
  import('./components/CsvUploadView.tsx').then((m) => ({ default: m.CsvUploadView }))
);
import type { ClassPlan, DateRange, TermSummary, TrackerSummary } from './shared/types.ts';

type AdminTab = 'report' | 'planner' | 'print' | 'upload';

interface QrRoute {
  slug?: string;
  trackerId?: string;
}

function readQrRouteFromUrl(): QrRoute | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const trackerId = params.get('tracker');
  const trackSlug = params.get('track');
  if (trackerId) return { trackerId };
  if (trackSlug) return { slug: trackSlug };
  return null;
}

export default function App() {
  const [qrRoute, setQrRoute] = useState<QrRoute | null>(() => readQrRouteFromUrl());
  const [isAdminQrPreview, setIsAdminQrPreview] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('report');

  const [activeTermName, setActiveTermName] = useState('December 2026 Exams');
  const [savedTerms, setSavedTerms] = useState<TermSummary[]>([]);
  const [plans, setPlans] = useState<ClassPlan[]>([]);
  const [trackersSummary, setTrackersSummary] = useState<Record<string, TrackerSummary>>({});
  const [globalDateRange, setGlobalDateRange] = useState<DateRange>(DEFAULT_DATE_RANGE);
  const [skippedNonNovCount, setSkippedNonNovCount] = useState(0);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [printSheetStyle, setPrintSheetStyle] = useState<'minimal' | 'detailed' | 'guide'>('minimal');
  const [loading, setLoading] = useState(() => readQrRouteFromUrl() === null);
  const [error, setError] = useState<string | null>(null);

  // Term Modal State
  const [showSaveTermModal, setShowSaveTermModal] = useState(false);
  const [termNameInput, setTermNameInput] = useState('');
  const [showDeleteTermModal, setShowDeleteTermModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string>('active');
  const [termBusy, setTermBusy] = useState(false);
  const [termNotice, setTermNotice] = useState<string | null>(null);

  const applyAppState = useCallback((data: AppStateResponse) => {
    setActiveTermName(data.activeTermName || 'December 2026 Exams');
    setSavedTerms(data.savedTerms || []);
    setPlans(data.plans);
    setTrackersSummary(data.trackersSummary);
    setGlobalDateRange(data.globalDateRange);
    setSkippedNonNovCount(data.skippedNonNovCount);
    setSelectedPlanId((prev) =>
      prev && data.plans.some((p) => p.id === prev) ? prev : data.plans[0]?.id ?? ''
    );
  }, []);

  const loadState = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchAppState();
      applyAppState(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [applyAppState]);

  useEffect(() => {
    // Strictly avoid fetching admin state or other classes when loaded from a QR link
    if (!qrRoute) {
      void loadState();
    }
  }, [qrRoute, loadState]);

  useEffect(() => {
    const onPopState = () => {
      const next = readQrRouteFromUrl();
      setQrRoute(next);
      if (!next) {
        setIsAdminQrPreview(false);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openQrPreview = (slug: string, trackerId?: string) => {
    const url = trackerId
      ? `/?tracker=${encodeURIComponent(trackerId)}`
      : `/?track=${encodeURIComponent(slug)}`;
    window.history.pushState({}, '', url);
    setIsAdminQrPreview(true);
    setQrRoute(trackerId ? { trackerId } : { slug });
  };

  const exitQrToAdmin = () => {
    window.history.pushState({}, '', '/');
    setIsAdminQrPreview(false);
    setQrRoute(null);
    void loadState();
  };

  const handleSaveTermSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = termNameInput.trim() || activeTermName || 'Exam Revision Term';
    setTermBusy(true);
    try {
      const res = await saveTermSnapshot(cleanName);
      applyAppState(res);
      setShowSaveTermModal(false);
      setTermNotice(`Saved term data "${res.savedTerm.name}" (${res.savedTerm.classCount} classes).`);
    } catch (err) {
      setTermNotice((err as Error).message);
    } finally {
      setTermBusy(false);
    }
  };

  const handleLoadSavedTerm = async (termId: string) => {
    if (!termId) return;
    setTermBusy(true);
    try {
      const res = await loadTermSnapshot(termId);
      applyAppState(res);
      setTermNotice(`Loaded term "${res.activeTermName}".`);
    } catch (err) {
      setTermNotice((err as Error).message);
    } finally {
      setTermBusy(false);
    }
  };

  const handleDeleteTermConfirm = async () => {
    setTermBusy(true);
    try {
      if (deleteTargetId === 'active') {
        const res = await clearActiveTerm();
        applyAppState(res);
        setTermNotice('Cleared active term classes and student progress.');
      } else {
        const deletedName =
          savedTerms.find((t) => t.id === deleteTargetId)?.name || 'Saved term';
        const res = await deleteTermSnapshot(deleteTargetId);
        applyAppState(res);
        setTermNotice(`Deleted saved term "${deletedName}".`);
      }
      setShowDeleteTermModal(false);
    } catch (err) {
      setTermNotice((err as Error).message);
    } finally {
      setTermBusy(false);
    }
  };

  if (qrRoute) {
    return (
      <>
        <MobileQrTracker
          classSlug={qrRoute.slug}
          trackerId={qrRoute.trackerId}
          onExitToAdmin={isAdminQrPreview ? exitQrToAdmin : undefined}
          onTrackerUpdated={isAdminQrPreview ? () => void loadState() : undefined}
        />
        <OfflineIndicator />
      </>
    );
  }

  const navItems: Array<{ id: AdminTab; label: string }> = [
    { id: 'report', label: 'Admin Report' },
    { id: 'planner', label: 'Day-by-Day' },
    { id: 'print', label: 'Print & QR' },
    { id: 'upload', label: 'Data Upload' },
  ];

  return (
    <div className="min-h-screen bg-[#F7F7F5] text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('report')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
          >
            Maktab Revision
          </button>

          {/* Zone 2: 4 single-line text navigation links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                    active
                      ? 'border-teal-700 text-slate-900 font-semibold'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('print')}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Sheets
            </button>
          </div>
        </div>

        {/* Mobile Secondary Tab Bar */}
        <div className="flex md:hidden border-t border-slate-100 bg-white px-2 overflow-x-auto">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex-1 min-h-[42px] px-3 text-xs font-medium whitespace-nowrap shrink-0 border-b-2 ${
                  active
                    ? 'border-teal-700 text-teal-800 font-semibold'
                    : 'border-transparent text-slate-600'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 space-y-6">
        {!loading && !error && (
          <section className="no-print flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <span className="font-semibold text-slate-900">
                Active Term: {activeTermName}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="text-slate-500 font-mono-tabular">
                {plans.length} classes · Start {globalDateRange.startDate} · Quran{' '}
                {globalDateRange.quranEndDate || globalDateRange.endDate} · IS/Duas{' '}
                {globalDateRange.endDate}
              </span>
              {savedTerms.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <FolderOpen className="h-3.5 w-3.5 text-slate-400" />
                  <select
                    aria-label="Load saved term"
                    value=""
                    disabled={termBusy}
                    onChange={(e) => {
                      if (e.target.value) void handleLoadSavedTerm(e.target.value);
                    }}
                    className="min-h-[34px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 focus:border-teal-700 focus:outline-none"
                  >
                    <option value="">Switch Saved Term ({savedTerms.length})...</option>
                    {savedTerms.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.classCount} classes)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {termNotice && (
                <span className="text-xs font-medium text-teal-800 mr-1">{termNotice}</span>
              )}
              <button
                type="button"
                disabled={termBusy}
                onClick={() => {
                  setTermNameInput(activeTermName);
                  setShowSaveTermModal(true);
                }}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-100 whitespace-nowrap shrink-0"
              >
                <BookmarkCheck className="h-3.5 w-3.5" />
                Save Term Data
              </button>
              <button
                type="button"
                disabled={termBusy}
                onClick={() => {
                  setDeleteTargetId('active');
                  setShowDeleteTermModal(true);
                }}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Term Data
              </button>
            </div>
          </section>
        )}

        {loading ? (
          <div className="space-y-4">
            <div className="h-24 rounded-xl bg-slate-200/70 animate-pulse" />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="h-24 rounded-xl bg-slate-200/70 animate-pulse" />
              <div className="h-24 rounded-xl bg-slate-200/70 animate-pulse" />
              <div className="h-24 rounded-xl bg-slate-200/70 animate-pulse" />
              <div className="h-24 rounded-xl bg-slate-200/70 animate-pulse" />
            </div>
            <div className="h-80 rounded-2xl bg-slate-200/70 animate-pulse" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-white p-8 text-center">
            <h2 className="text-lg font-bold text-slate-900">Unable to load revision plans</h2>
            <p className="mt-1 text-sm text-slate-600">{error}</p>
            <button
              type="button"
              onClick={() => void loadState()}
              className="mt-4 min-h-[40px] rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
            >
              Retry
            </button>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="space-y-4">
                <div className="h-24 rounded-xl bg-slate-200/70 animate-pulse" />
                <div className="h-80 rounded-2xl bg-slate-200/70 animate-pulse" />
              </div>
            }
          >
            {activeTab === 'report' && (
              <AdminReport
                activeTermName={activeTermName}
                plans={plans}
                trackersSummary={trackersSummary}
                globalDateRange={globalDateRange}
                skippedNonNovCount={skippedNonNovCount}
                selectedPlanId={selectedPlanId}
                onSelectPlanId={setSelectedPlanId}
                includeWeekends={includeWeekends}
                onToggleWeekends={setIncludeWeekends}
                onOpenDayEditor={(id) => {
                  setSelectedPlanId(id);
                  setActiveTab('planner');
                }}
                onOpenPrintSheet={(id) => {
                  setSelectedPlanId(id);
                  setActiveTab('print');
                }}
                onOpenDetailedGuide={(id) => {
                  setSelectedPlanId(id);
                  setPrintSheetStyle('guide');
                  setActiveTab('print');
                }}
                onOpenQrPreview={openQrPreview}
                onSaveClassNotes={async (planId, notes) => {
                  const res = await savePlanSyllabusNotes(planId, { notes });
                  setPlans((prev) => prev.map((p) => (p.id === planId ? res.plan : p)));
                  setTrackersSummary(res.trackersSummary);
                }}
                onBulkSaveNotes={async (items) => {
                  const res = await bulkSaveSyllabusNotes(items);
                  setPlans(res.plans);
                  setTrackersSummary(res.trackersSummary);
                  return res.updatedCount;
                }}
              />
            )}

            {activeTab === 'planner' && (
              <DayByDayPlanner
                plans={plans}
                trackersSummary={trackersSummary}
                globalDateRange={globalDateRange}
                selectedPlanId={selectedPlanId}
                onSelectPlanId={setSelectedPlanId}
                includeWeekends={includeWeekends}
                onToggleWeekends={setIncludeWeekends}
                onRefreshState={loadState}
                onUpdateGlobalDateRange={async (startDate, endDate, quranEndDate, overwriteManual) => {
                  const res = await updateGlobalDateRange({
                    startDate,
                    endDate,
                    quranEndDate,
                    overwriteManual,
                  });
                  setGlobalDateRange(res.globalDateRange);
                  setPlans(res.plans);
                  setTrackersSummary(res.trackersSummary);
                }}
                onSavePlan={async (id, payload) => {
                  const res = await updateClassPlan(id, payload);
                  setPlans((prev) => prev.map((p) => (p.id === id ? res.plan : p)));
                  setTrackersSummary(res.trackersSummary);
                }}
                onAddPlan={async (payload) => {
                  const res = await addClassPlan(payload);
                  setPlans((prev) => [res.plan, ...prev]);
                  setSelectedPlanId(res.plan.id);
                  setTrackersSummary(res.trackersSummary);
                }}
                onDeletePlan={async (id) => {
                  const res = await deleteClassPlan(id);
                  setPlans((prev) => {
                    const next = prev.filter((p) => p.id !== id);
                    if (selectedPlanId === id) {
                      setSelectedPlanId(next[0]?.id ?? '');
                    }
                    return next;
                  });
                  setTrackersSummary(res.trackersSummary);
                }}
              />
            )}

            {activeTab === 'print' && (
              <PrintStudio
                plans={plans}
                trackersSummary={trackersSummary}
                activeTermName={activeTermName}
                globalDateRange={globalDateRange}
                selectedPlanId={selectedPlanId}
                onSelectPlanId={setSelectedPlanId}
                includeWeekends={includeWeekends}
                onToggleWeekends={setIncludeWeekends}
                sheetStyle={printSheetStyle}
                onChangeSheetStyle={setPrintSheetStyle}
                onOpenSyllabusInput={(id) => {
                  setSelectedPlanId(id);
                  setActiveTab('report');
                }}
                onOpenQrPreview={openQrPreview}
                onTrackerCreated={loadState}
                onSavePlan={async (id, payload) => {
                  const res = await updateClassPlan(id, payload);
                  setPlans((prev) => prev.map((p) => (p.id === id ? res.plan : p)));
                  setTrackersSummary(res.trackersSummary);
                }}
                onUpdateGlobalDateRange={async (startDate, endDate, quranEndDate, overwriteManual) => {
                  const res = await updateGlobalDateRange({
                    startDate,
                    endDate,
                    quranEndDate,
                    overwriteManual,
                  });
                  setGlobalDateRange(res.globalDateRange);
                  setPlans(res.plans);
                  setTrackersSummary(res.trackersSummary);
                }}
              />
            )}

            {activeTab === 'upload' && (
              <CsvUploadView
                globalDateRange={globalDateRange}
                onImportCsv={async (payload) => {
                  const res = await uploadCsvPlans(payload);
                  applyAppState(res);
                  return {
                    importedCount: res.importedCount,
                    skippedCount: res.skippedCount,
                  };
                }}
                onResetDefault={async () => {
                  const res = await resetSeedPlans();
                  applyAppState(res);
                }}
              />
            )}
          </Suspense>
        )}
      </main>

      {/* Save Term Data Modal */}
      {showSaveTermModal && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold text-slate-900">Save Term Data</h2>
              <button
                type="button"
                onClick={() => setShowSaveTermModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close save term dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSaveTermSubmit(e)} className="mt-4 space-y-4">
              <div>
                <label htmlFor="save-term-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Term Name
                </label>
                <input
                  id="save-term-name"
                  required
                  type="text"
                  value={termNameInput}
                  onChange={(e) => setTermNameInput(e.target.value)}
                  placeholder="e.g. December 2026 Exams"
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
              <p className="text-xs leading-relaxed text-slate-600">
                Saves all <strong>{plans.length} classes</strong>, the{' '}
                <span className="font-mono-tabular">
                  {globalDateRange.startDate} → Quran{' '}
                  {globalDateRange.quranEndDate || globalDateRange.endDate} / IS{' '}
                  {globalDateRange.endDate}
                </span>{' '}
                revision dates, and all synced student QR trackers into the server term archive.
              </p>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSaveTermModal(false)}
                  className="min-h-[40px] rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={termBusy}
                  className="min-h-[40px] rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  Save Term Snapshot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Term Data Modal */}
      {showDeleteTermModal && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold text-slate-900">Delete Term Data</h2>
              <button
                type="button"
                onClick={() => setShowDeleteTermModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close delete term dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-700">
                Choose what to delete
              </label>
              <select
                value={deleteTargetId}
                onChange={(e) => setDeleteTargetId(e.target.value)}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-900 focus:border-rose-600 focus:bg-white focus:outline-none"
              >
                <option value="active">
                  Clear Active Term Workspace ({plans.length} classes, current trackers)
                </option>
                {savedTerms.map((t) => (
                  <option key={t.id} value={t.id}>
                    Delete Saved Snapshot: {t.name} ({t.classCount} classes)
                  </option>
                ))}
              </select>

              <p className="rounded-lg bg-rose-50 border border-rose-200/70 p-3 text-xs leading-relaxed text-rose-900">
                {deleteTargetId === 'active'
                  ? 'This removes all active class plans and guardian QR progress from the current workspace. Save the term first if you want a backup.'
                  : 'This permanently removes the selected saved term snapshot from your term archive.'}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowDeleteTermModal(false)}
                className="min-h-[40px] rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={termBusy}
                onClick={() => void handleDeleteTermConfirm()}
                className="min-h-[40px] rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
              >
                {deleteTargetId === 'active' ? 'Clear Active Term' : 'Delete Saved Term'}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="no-print border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 text-xs text-slate-500 sm:px-6 lg:px-8">
          <span>Exam Revision Planner · Parent QR &amp; Daily Push Sync</span>
          <PWAInstallButton variant="compact" />
        </div>
      </footer>

      <OfflineIndicator />
    </div>
  );
}
