import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  FileSpreadsheet,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import { parseSpreadsheetFile } from '../lib/spreadsheetImport.ts';
import {
  getClassSubjectOptions,
  getSyllabusNotesList,
  parseSyllabusSheetsToDrafts,
  type ParsedSyllabusDraft,
} from '../shared/syllabus.ts';
import type { ClassPlan } from '../shared/types.ts';

interface SyllabusNotesPanelProps {
  activeTermName: string;
  plans: ClassPlan[];
  activePlan: ClassPlan | null;
  onSelectPlanId: (id: string) => void;
  onSaveClassNotes: (
    planId: string,
    notes: Record<string, { subject?: string; content: string; sourceFile?: string }>
  ) => Promise<void>;
  onBulkSaveNotes: (
    items: Array<{ classPlanId: string; subject: string; content: string; sourceFile?: string }>
  ) => Promise<number>;
  onOpenDetailedGuide: (planId: string) => void;
}

export const SyllabusNotesPanel: React.FC<SyllabusNotesPanelProps> = ({
  activeTermName,
  plans,
  activePlan,
  onSelectPlanId,
  onSaveClassNotes,
  onBulkSaveNotes,
  onOpenDetailedGuide,
}) => {
  const targetPlan = activePlan ?? plans[0] ?? null;
  const subjectOptions = useMemo(
    () => (targetPlan ? getClassSubjectOptions(targetPlan) : []),
    [targetPlan]
  );
  const savedNotes = useMemo(
    () => (targetPlan ? getSyllabusNotesList(targetPlan) : []),
    [targetPlan]
  );

  const [inputMode, setInputMode] = useState<'text' | 'file'>('text');
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [customSubject, setCustomSubject] = useState('');
  const [noteText, setNoteText] = useState('');

  // File upload state
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ParsedSyllabusDraft[]>([]);

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const totalTermSubjectsSaved = useMemo(
    () =>
      plans.reduce((acc, p) => {
        const count = Object.values(p.syllabusNotes ?? {}).filter((n) => n.content.trim()).length;
        return acc + count;
      }, 0),
    [plans]
  );

  // Sync default subject when class changes
  useEffect(() => {
    if (!targetPlan) return;
    const opts = getClassSubjectOptions(targetPlan);
    setSelectedSubject((prev) => {
      if (prev === '__custom__') return prev;
      if (prev && opts.includes(prev)) return prev;
      return opts[0] ?? 'General Revision';
    });
  }, [targetPlan?.id, targetPlan?.trackType, targetPlan?.targets]);

  // Load saved note content whenever class or selected subject changes
  useEffect(() => {
    if (!targetPlan) {
      setNoteText('');
      return;
    }
    const effectiveSubject =
      selectedSubject === '__custom__' ? customSubject.trim() : selectedSubject;
    if (!effectiveSubject) {
      setNoteText('');
      return;
    }
    const match = Object.values(targetPlan.syllabusNotes ?? {}).find(
      (n) => n.subject.toLowerCase() === effectiveSubject.toLowerCase()
    );
    setNoteText(match?.content ?? '');
  }, [targetPlan, selectedSubject, customSubject]);

  const effectiveSubjectName =
    selectedSubject === '__custom__' ? customSubject.trim() : selectedSubject;

  const existingMatch = useMemo(() => {
    if (!targetPlan || !effectiveSubjectName) return null;
    return (
      Object.values(targetPlan.syllabusNotes ?? {}).find(
        (n) => n.subject.toLowerCase() === effectiveSubjectName.toLowerCase()
      ) ?? null
    );
  }, [targetPlan, effectiveSubjectName]);

  const handleSaveTextNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPlan || !effectiveSubjectName) return;
    setBusy(true);
    setFeedback(null);
    try {
      await onSaveClassNotes(targetPlan.id, {
        [effectiveSubjectName]: {
          subject: effectiveSubjectName,
          content: noteText.trim(),
        },
      });
      if (selectedSubject === '__custom__' && noteText.trim()) {
        setSelectedSubject(effectiveSubjectName);
        setCustomSubject('');
      }
      setFeedback({
        type: 'ok',
        text: noteText.trim()
          ? `Saved ${effectiveSubjectName} syllabus notes for ${targetPlan.className} (${activeTermName}).`
          : `Removed ${effectiveSubjectName} syllabus notes from ${targetPlan.className}.`,
      });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSavedSubject = async (subject: string) => {
    if (!targetPlan) return;
    setBusy(true);
    setFeedback(null);
    try {
      await onSaveClassNotes(targetPlan.id, {
        [subject]: { subject, content: '' },
      });
      if (effectiveSubjectName.toLowerCase() === subject.toLowerCase()) {
        setNoteText('');
      }
      setFeedback({
        type: 'ok',
        text: `Removed ${subject} syllabus notes from ${targetPlan.className}.`,
      });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const processFile = async (file: File) => {
    if (!targetPlan) return;
    setFeedback(null);
    try {
      const parsed = await parseSpreadsheetFile(file);
      const fallbackSub = effectiveSubjectName || subjectOptions[0] || 'General Revision';
      const nextDrafts = parseSyllabusSheetsToDrafts(
        parsed.sheets,
        plans,
        targetPlan.id,
        fallbackSub,
        file.name
      );
      if (nextDrafts.length === 0) {
        setDrafts([]);
        setUploadedFileName(file.name);
        setFeedback({
          type: 'err',
          text: 'No syllabus text or rows were found in the uploaded spreadsheet.',
        });
        return;
      }
      setUploadedFileName(file.name);
      setDrafts(nextDrafts);
      setFeedback({
        type: 'ok',
        text: `Parsed ${nextDrafts.length} subject note block${nextDrafts.length > 1 ? 's' : ''} from ${file.name}. Review below and save to term.`,
      });
    } catch (err) {
      setDrafts([]);
      setFeedback({
        type: 'err',
        text: (err as Error).message || 'Could not read Excel or spreadsheet file.',
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleSaveImportedDrafts = async () => {
    const valid = drafts.filter((d) => d.classPlanId && d.subject.trim() && d.content.trim());
    if (valid.length === 0) return;
    setBusy(true);
    setFeedback(null);
    try {
      const count = await onBulkSaveNotes(
        valid.map((d) => ({
          classPlanId: d.classPlanId,
          subject: d.subject.trim(),
          content: d.content.trim(),
          sourceFile: d.sourceFile,
        }))
      );
      setDrafts([]);
      setUploadedFileName(null);
      setFeedback({
        type: 'ok',
        text: `Saved ${count} syllabus note${count > 1 ? 's' : ''} into ${activeTermName}. Ready to link in Detailed Revision Guide.`,
      });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!targetPlan) return null;

  return (
    <section
      id="admin-syllabus-notes"
      className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span className="text-teal-800 font-semibold">Term Syllabus Repository</span>
            <span aria-hidden="true">·</span>
            <span>{activeTermName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">
              {totalTermSubjectsSaved} subject notes saved across classes
            </span>
          </div>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Syllabus Notes by Subject &amp; Class
          </h2>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            Enter text or upload an Excel / Sheets file per subject and class for this term, then
            link saved notes straight into the Detailed Revision Guide tracker printout.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onOpenDetailedGuide(targetPlan.id)}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Link to Detailed Revision Guide
        </button>
      </div>

      {/* Class Selector + Input Mode Toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-[240px] flex-1 max-w-md">
          <label
            htmlFor="syllabus-class-select"
            className="block text-xs font-medium text-slate-600 mb-1"
          >
            Active Class for Syllabus Notes
          </label>
          <select
            id="syllabus-class-select"
            value={targetPlan.id}
            onChange={(e) => {
              onSelectPlanId(e.target.value);
              setFeedback(null);
            }}
            className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
          >
            {plans.map((p) => {
              const savedCount = Object.values(p.syllabusNotes ?? {}).filter((n) =>
                n.content.trim()
              ).length;
              return (
                <option key={p.id} value={p.id}>
                  {p.className} — {p.teacherName}
                  {savedCount > 0 ? ` (${savedCount} saved)` : ''}
                </option>
              );
            })}
          </select>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setInputMode('text');
              setFeedback(null);
            }}
            className={`min-h-[34px] rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              inputMode === 'text'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Text Note Input
          </button>
          <button
            type="button"
            onClick={() => {
              setInputMode('file');
              setFeedback(null);
            }}
            className={`min-h-[34px] rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              inputMode === 'file'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Excel / Sheets Upload
          </button>
        </div>
      </div>

      {/* Main Split Workspace: Input (7 cols) | Saved Class Syllabus Notes (5 cols) */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left: Input Form */}
        <div className="lg:col-span-7 space-y-4">
          {inputMode === 'text' ? (
            <form onSubmit={(e) => void handleSaveTextNote(e)} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="syllabus-subject-select"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Subject
                  </label>
                  <select
                    id="syllabus-subject-select"
                    value={selectedSubject}
                    onChange={(e) => {
                      setSelectedSubject(e.target.value);
                      setFeedback(null);
                    }}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                  >
                    {subjectOptions.map((subj) => {
                      const hasSaved = Boolean(
                        Object.values(targetPlan.syllabusNotes ?? {}).find(
                          (n) =>
                            n.subject.toLowerCase() === subj.toLowerCase() &&
                            n.content.trim().length > 0
                        )
                      );
                      return (
                        <option key={subj} value={subj}>
                          {subj}
                          {hasSaved ? ' (Saved)' : ''}
                        </option>
                      );
                    })}
                    <option value="__custom__">+ Custom Subject...</option>
                  </select>
                </div>

                {selectedSubject === '__custom__' && (
                  <div>
                    <label
                      htmlFor="syllabus-custom-subject"
                      className="block text-xs font-medium text-slate-600 mb-1"
                    >
                      Custom Subject Name
                    </label>
                    <input
                      id="syllabus-custom-subject"
                      type="text"
                      value={customSubject}
                      onChange={(e) => setCustomSubject(e.target.value)}
                      placeholder="e.g. Arabic Vocabulary"
                      className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="syllabus-note-textarea"
                    className="block text-xs font-medium text-slate-600"
                  >
                    Syllabus Notes for {targetPlan.className} ·{' '}
                    {effectiveSubjectName || 'Select Subject'}
                  </label>
                  <span className="text-[11px] text-slate-400 font-mono-tabular">
                    {noteText.length} chars
                  </span>
                </div>
                <textarea
                  id="syllabus-note-textarea"
                  rows={8}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Enter key topics, rulings, definitions, Q&A prompts, memorisation tips, or revision notes for this subject..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:bg-white focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={busy || !effectiveSubjectName || (!noteText.trim() && !existingMatch)}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save Subject Note
                  </button>

                  {existingMatch && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDeleteSavedSubject(existingMatch.subject)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove Note
                    </button>
                  )}
                </div>

                <span className="text-xs text-slate-500">
                  Saves to {activeTermName} snapshot
                </span>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="syllabus-upload-subject"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Default Subject (when sheet has no Subject column)
                  </label>
                  <select
                    id="syllabus-upload-subject"
                    value={selectedSubject}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                  >
                    {subjectOptions.map((subj) => (
                      <option key={subj} value={subj}>
                        {subj}
                      </option>
                    ))}
                    <option value="__custom__">+ Custom Subject...</option>
                  </select>
                </div>

                {selectedSubject === '__custom__' && (
                  <div>
                    <label
                      htmlFor="syllabus-upload-custom"
                      className="block text-xs font-medium text-slate-600 mb-1"
                    >
                      Custom Subject Name
                    </label>
                    <input
                      id="syllabus-upload-custom"
                      type="text"
                      value={customSubject}
                      onChange={(e) => setCustomSubject(e.target.value)}
                      placeholder="e.g. Tafseer Notes"
                      className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <label
                htmlFor="syllabus-file-input"
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => void handleDrop(e)}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-7 text-center transition-colors ${
                  isDragging
                    ? 'border-teal-700 bg-teal-50/60'
                    : 'border-slate-300 bg-slate-50/80 hover:border-teal-700 hover:bg-teal-50/30'
                }`}
              >
                <Upload className="h-6 w-6 text-teal-700" />
                <span className="mt-2 text-sm font-semibold text-slate-900">
                  {uploadedFileName
                    ? `Loaded: ${uploadedFileName}`
                    : 'Drop or select an Excel / Google Sheets CSV export'}
                </span>
                <span className="mt-1 text-xs text-slate-500 max-w-md">
                  Supports .xlsx, .xls, .ods, .csv · Accepts single-subject topic tables,
                  multi-tab subject sheets, or multi-class tables with Class / Subject / Notes
                  columns.
                </span>
                <input
                  id="syllabus-file-input"
                  type="file"
                  accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet,text/csv,text/tab-separated-values"
                  onChange={(e) => void handleFileChange(e)}
                  className="sr-only"
                />
              </label>

              {drafts.length > 0 && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                      <FileSpreadsheet className="h-4 w-4 text-teal-700" />
                      <span>
                        Ready to Save ({drafts.length} subject note
                        {drafts.length > 1 ? 's' : ''})
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSaveImportedDrafts()}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-45 whitespace-nowrap cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Save Imported Notes to Term
                    </button>
                  </div>

                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                    {drafts.map((draft, idx) => (
                      <div key={draft.id} className="p-3 space-y-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              aria-label="Target class"
                              value={draft.classPlanId}
                              onChange={(e) => {
                                const nextPlan = plans.find((p) => p.id === e.target.value);
                                if (!nextPlan) return;
                                setDrafts((prev) =>
                                  prev.map((d, i) =>
                                    i === idx
                                      ? {
                                          ...d,
                                          classPlanId: nextPlan.id,
                                          className: nextPlan.className,
                                          teacherName: nextPlan.teacherName,
                                        }
                                      : d
                                  )
                                );
                              }}
                              className="min-h-[30px] rounded border border-slate-200 bg-slate-50 px-2 font-medium text-slate-900"
                            >
                              {plans.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.className} ({p.teacherName})
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              aria-label="Draft subject"
                              value={draft.subject}
                              onChange={(e) =>
                                setDrafts((prev) =>
                                  prev.map((d, i) =>
                                    i === idx ? { ...d, subject: e.target.value } : d
                                  )
                                )
                              }
                              className="min-h-[30px] w-36 rounded border border-slate-200 bg-slate-50 px-2 font-semibold text-slate-900"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setDrafts((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-slate-400 hover:text-rose-700 p-1"
                            aria-label="Discard draft"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <textarea
                          rows={3}
                          value={draft.content}
                          onChange={(e) =>
                            setDrafts((prev) =>
                              prev.map((d, i) =>
                                i === idx ? { ...d, content: e.target.value } : d
                              )
                            )
                          }
                          className="w-full rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800 focus:border-teal-700 focus:bg-white focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {feedback && (
            <p
              className={`text-xs font-medium ${
                feedback.type === 'ok' ? 'text-teal-800' : 'text-rose-700'
              }`}
            >
              {feedback.text}
            </p>
          )}
        </div>

        {/* Right: Saved Notes for Selected Class */}
        <div className="lg:col-span-5 lg:border-l lg:border-slate-100 lg:pl-6 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Saved Notes · {targetPlan.className}
            </h3>
            <span className="text-xs text-slate-500 font-mono-tabular">
              {savedNotes.length} subject{savedNotes.length === 1 ? '' : 's'}
            </span>
          </div>

          {savedNotes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5 text-xs leading-relaxed text-slate-600">
              <p className="font-semibold text-slate-800">
                No syllabus notes saved for {targetPlan.className} yet
              </p>
              <p className="mt-1">
                Pick a subject on the left to write syllabus notes or import from an Excel/Sheets
                file. Saved notes stay attached to this class and term so you can output a linked{' '}
                <strong>Detailed Revision Guide</strong>.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border-t border-b border-slate-100">
              {savedNotes.map((entry) => (
                <div key={entry.subject} className="py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {entry.subject}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono-tabular">
                        {entry.sourceFile ? `From ${entry.sourceFile}` : 'Manual entry'} ·{' '}
                        {new Date(entry.updatedAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setInputMode('text');
                          if (subjectOptions.includes(entry.subject)) {
                            setSelectedSubject(entry.subject);
                          } else {
                            setSelectedSubject('__custom__');
                            setCustomSubject(entry.subject);
                          }
                          setNoteText(entry.content);
                        }}
                        className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDeleteSavedSubject(entry.subject)}
                        className="inline-flex min-h-[32px] items-center justify-center rounded-md border border-slate-200 px-2 text-slate-500 hover:border-rose-200 hover:text-rose-700 cursor-pointer"
                        aria-label={`Remove ${entry.subject} note`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-slate-700 whitespace-pre-line line-clamp-4">
                    {entry.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
