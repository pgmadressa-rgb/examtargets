import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, RotateCcw, Upload } from 'lucide-react';
import { parseSpreadsheetFile, type ImportedSheet } from '../lib/spreadsheetImport.ts';
import { groupPlansByTeacher, parseMadrasahCsv } from '../shared/planEngine.ts';
import type { DateRange } from '../shared/types.ts';

interface CsvUploadViewProps {
  globalDateRange: DateRange;
  onImportCsv: (payload: {
    csvText: string;
    onlyNovember2026: boolean;
    startDate: string;
    endDate: string;
  }) => Promise<{ importedCount: number; skippedCount: number }>;
  onResetDefault: () => Promise<void>;
}

export const CsvUploadView: React.FC<CsvUploadViewProps> = ({
  globalDateRange,
  onImportCsv,
  onResetDefault,
}) => {
  const [csvText, setCsvText] = useState('');
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [workbookSheets, setWorkbookSheets] = useState<ImportedSheet[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [onlyNov, setOnlyNov] = useState(true);
  const [startDate, setStartDate] = useState(globalDateRange.startDate);
  const [endDate, setEndDate] = useState(globalDateRange.endDate);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setStartDate(globalDateRange.startDate);
    setEndDate(globalDateRange.endDate);
  }, [globalDateRange.startDate, globalDateRange.endDate]);

  const preview = useMemo(() => {
    if (!csvText.trim()) return null;
    return parseMadrasahCsv(csvText, {
      onlyNovember2026: onlyNov,
      dateRange: { startDate, endDate },
    });
  }, [csvText, onlyNov, startDate, endDate]);

  const multiClassTeachers = useMemo(() => {
    if (!preview) return [];
    return groupPlansByTeacher(preview.plans).filter((g) => g.plans.length > 1);
  }, [preview]);

  const loadSelectedFile = async (file: File) => {
    setFeedback(null);
    try {
      const parsed = await parseSpreadsheetFile(file);
      const initialSheet =
        parsed.sheets.find((s) => s.name === parsed.defaultSheetName) ?? parsed.sheets[0];

      setWorkbookSheets(parsed.isWorkbook ? parsed.sheets : []);
      setSelectedSheetName(parsed.isWorkbook ? initialSheet.name : '');
      setCsvText(initialSheet.csvText);
      setSourceLabel(file.name);
    } catch (err) {
      setWorkbookSheets([]);
      setSelectedSheetName('');
      setFeedback({ type: 'err', text: (err as Error).message || 'Could not read spreadsheet file.' });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadSelectedFile(file);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await loadSelectedFile(file);
    }
  };

  const handleSheetChange = (sheetName: string) => {
    const found = workbookSheets.find((s) => s.name === sheetName);
    if (!found) return;
    setSelectedSheetName(found.name);
    setCsvText(found.csvText);
    setFeedback(null);
  };

  const handleImport = async () => {
    if (!csvText.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await onImportCsv({
        csvText,
        onlyNovember2026: onlyNov,
        startDate,
        endDate,
      });
      setFeedback({
        type: 'ok',
        text: `Imported ${res.importedCount} class plan${res.importedCount === 1 ? '' : 's'} (${res.skippedCount} filtered rows skipped).`,
      });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await onResetDefault();
      setCsvText('');
      setSourceLabel(null);
      setWorkbookSheets([]);
      setSelectedSheetName('');
      setFeedback({
        type: 'ok',
        text: 'Restored the pre-loaded November 2026 madrasah response dataset.',
      });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Upload Teacher &amp; Class Data
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Upload an Excel workbook (.xlsx, .xls, .ods) or CSV export, or paste cells directly from
            Excel. Supports reordered headers, new fields, and teachers with two or more classes.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleRestore()}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restore Default Nov 2026 Data
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
          <label
            htmlFor="csv-file-input"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => void handleDrop(e)}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition-colors ${
              isDragging
                ? 'border-teal-700 bg-teal-50/60'
                : 'border-slate-300 bg-slate-50/80 hover:border-teal-700 hover:bg-teal-50/30'
            }`}
          >
            <Upload className="h-6 w-6 text-teal-700" />
            <span className="mt-2 text-sm font-semibold text-slate-900">
              Select or drop an Excel / CSV file
            </span>
            <span className="mt-1 text-xs text-slate-500">
              Supports .xlsx, .xls, .xlsm, .ods, .csv, Class 2 columns, and Excel or UK dates
            </span>
            <input
              id="csv-file-input"
              type="file"
              accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet,text/csv,text/tab-separated-values"
              onChange={(e) => void handleFileChange(e)}
              className="sr-only"
            />
          </label>

          {workbookSheets.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <label htmlFor="excel-sheet-select" className="text-xs font-semibold text-slate-700">
                Workbook Sheet ({workbookSheets.length} tabs found)
              </label>
              <select
                id="excel-sheet-select"
                value={selectedSheetName}
                onChange={(e) => handleSheetChange(e.target.value)}
                className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
              >
                {workbookSheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({sheet.rowCount} rows)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="csv-paste" className="block text-xs font-medium text-slate-700 mb-1.5">
              Or paste rows copied from Excel / CSV
            </label>
            <textarea
              id="csv-paste"
              rows={7}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setWorkbookSheets([]);
                setSelectedSheetName('');
                setSourceLabel('Pasted Spreadsheet');
              }}
              placeholder="Timestamp,Ustadh/Apa Name,Which Class No.?,Quran or Qaidah Class?,..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-mono text-slate-800 focus:border-teal-700 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyNov}
                  onChange={(e) => setOnlyNov(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700"
                />
                Filter strictly to November 2026 rows
              </label>

              <div className="flex items-center gap-2 text-xs">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono-tabular"
                />
                <span>to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono-tabular"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={!preview || preview.plans.length === 0 || busy}
              onClick={() => void handleImport()}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-teal-700 px-5 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4" />
              Generate Plans from Sheet
            </button>
          </div>

          {feedback && (
            <p
              className={`text-xs font-medium ${
                feedback.type === 'ok' ? 'text-teal-800' : 'text-rose-700'
              }`}
            >
              {feedback.text}
            </p>
          )}
        </section>

        {/* Live Parse Preview */}
        <aside className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 lg:col-span-5 self-start">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold text-slate-900">Import Preview</h2>
            </div>
            {sourceLabel && (
              <span className="text-[11px] font-medium text-slate-500 truncate max-w-[180px]">
                {selectedSheetName ? `${sourceLabel} · ${selectedSheetName}` : sourceLabel}
              </span>
            )}
          </div>

          {preview ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-lg font-bold text-slate-900 font-mono-tabular">
                    {preview.totalRows}
                  </div>
                  <div className="text-[11px] text-slate-500">Total Rows</div>
                </div>
                <div className="rounded-lg bg-teal-50 p-3">
                  <div className="text-lg font-bold text-teal-800 font-mono-tabular">
                    {preview.includedCount}
                  </div>
                  <div className="text-[11px] text-teal-800">Classes Generated</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-lg font-bold text-slate-600 font-mono-tabular">
                    {preview.skippedCount}
                  </div>
                  <div className="text-[11px] text-slate-500">Skipped Rows</div>
                </div>
              </div>

              {multiClassTeachers.length > 0 && (
                <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3 text-xs text-teal-950">
                  <span className="font-semibold">Multi-Class Teachers Detected:</span>{' '}
                  {multiClassTeachers
                    .map((g) => `${g.teacherName} (${g.plans.length} classes)`)
                    .join(' · ')}
                </div>
              )}

              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                {preview.plans.map((p) => (
                  <div key={p.id} className="px-3 py-2 text-xs">
                    <div className="flex items-center justify-between font-semibold text-slate-900">
                      <span>{p.className}</span>
                      <span className="font-normal text-slate-500">{p.teacherName}</span>
                    </div>
                    <div className="mt-0.5 text-slate-500">
                      {p.trackType} · {p.dailySchedule.length} daily plans generated
                      {p.targets.extraNotes && p.targets.extraNotes.length > 0
                        ? ` · +${p.targets.extraNotes.length} extra field${
                            p.targets.extraNotes.length > 1 ? 's' : ''
                          }`
                        : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-xs leading-relaxed text-slate-600">
              <p>
                Your workspace is seeded with the <strong>November 2026</strong> teacher responses
                from the updated spreadsheet (May 2026 rows excluded).
              </p>
              <div className="rounded-lg bg-slate-50 p-3 space-y-1.5">
                <div className="font-semibold text-slate-800">
                  Dual-Class (Quran &amp; Islamic Studies), Excel &amp; Multi-Sheet Support
                </div>
                <p className="text-slate-600">
                  Upload any Excel (.xlsx, .xls, .ods) or CSV export—when a teacher selects{' '}
                  <strong>Islamic Studies Class: Yes</strong> for a different class than their
                  Quran/Qaidah class, both classes split automatically with isolated targets.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
