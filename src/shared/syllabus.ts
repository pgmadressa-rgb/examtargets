import { isMeaningful, parseCsvRows } from './planEngine.ts';
import type { ClassPlan, SyllabusNoteEntry, TaskCategory } from './types.ts';

export const STANDARD_ISLAMIC_SUBJECTS = [
  'Fiqh',
  'Aqaaid',
  'Seerah',
  'Hadith',
  'Adaab',
  'Islamic History',
  'Akhlaaq',
  'Duas',
] as const;

export function getReadingSubjectLabel(plan: ClassPlan): string {
  if (plan.trackType === 'Qaidah') return 'Qaidah';
  if (plan.trackType === "Juzz 'Amma") return "Juzz 'Amma";
  return 'Quran / Panj Para';
}

export function getClassSubjectOptions(plan: ClassPlan): string[] {
  const ordered: string[] = [];
  const pushUnique = (label: string) => {
    const clean = label.trim();
    if (!clean) return;
    if (!ordered.some((item) => item.toLowerCase() === clean.toLowerCase())) {
      ordered.push(clean);
    }
  };

  if (plan.trackType !== 'Islamic Studies Only') {
    pushUnique(getReadingSubjectLabel(plan));
    pushUnique('Tajweed & Makhraj');
    pushUnique('Surahs');
  }

  const is = plan.targets.islamicStudies;
  const activeIslamic: Array<[string, string]> = [
    ['Fiqh', is.fiqh],
    ['Aqaaid', is.aqaaid],
    ['Seerah', is.seerah],
    ['Hadith', is.hadith],
    ['Adaab', is.adaab],
    ['Islamic History', is.islamicHistory],
    ['Akhlaaq', is.akhlaaq],
    ['Duas', is.duas],
  ];

  // Active target subjects first, then remaining Islamic Studies subjects
  for (const [label, val] of activeIslamic) {
    if (isMeaningful(val)) pushUnique(label);
  }
  if (plan.trackType === 'Islamic Studies Only' || is.enabled) {
    for (const label of STANDARD_ISLAMIC_SUBJECTS) {
      pushUnique(label);
    }
  }

  // Include any saved custom subjects
  if (plan.syllabusNotes) {
    for (const entry of Object.values(plan.syllabusNotes)) {
      pushUnique(entry.subject);
    }
  }

  if (ordered.length === 0) {
    pushUnique('General Revision');
  }

  return ordered;
}

export function normalizeSyllabusSubject(raw: string, plan?: ClassPlan): string {
  const clean = raw.trim().replace(/\s+/g, ' ');
  if (!clean) return 'General Revision';
  const lower = clean.toLowerCase();

  if (/\bfiqh\b|wudhu|wudu|salah|salaah|namaaz|namaz|taharah/.test(lower)) return 'Fiqh';
  if (/aqaa?id|aqeedah|aqidah|belief|kalimah|iman/.test(lower)) return 'Aqaaid';
  if (/seerah|sirah|prophet|nabi/.test(lower)) return 'Seerah';
  if (/hadith|hadeeth|ahadith|sunnah/.test(lower)) return 'Hadith';
  if (/adaab|adab|etiquette|manners/.test(lower)) return 'Adaab';
  if (/islamic\s*history|history|tareekh|tarikh/.test(lower)) return 'Islamic History';
  if (/akhlaa?q|character/.test(lower)) return 'Akhlaaq';
  if (/\bduas?\b|asma|names\s*of\s*allah/.test(lower)) return 'Duas';
  if (/tajweed|makhraj|makharij/.test(lower)) return 'Tajweed & Makhraj';
  if (/surah|surat/.test(lower)) return 'Surahs';
  if (/qaidah|qawaa?id|qaida/.test(lower)) return plan ? getReadingSubjectLabel(plan) : 'Qaidah';
  if (/juzz?\s*'?amma/.test(lower)) return plan ? getReadingSubjectLabel(plan) : "Juzz 'Amma";
  if (/quran|qur'an|panj\s*para/.test(lower)) {
    return plan ? getReadingSubjectLabel(plan) : 'Quran / Panj Para';
  }

  // Check if it matches an existing option case-insensitively
  if (plan) {
    const options = getClassSubjectOptions(plan);
    const match = options.find((o) => o.toLowerCase() === lower);
    if (match) return match;
  }

  return clean;
}

export function getSyllabusNotesList(plan: ClassPlan): SyllabusNoteEntry[] {
  const map = plan.syllabusNotes;
  if (!map) return [];
  const entries = Object.values(map).filter((e) => e.content.trim().length > 0);
  const options = getClassSubjectOptions(plan);
  return [...entries].sort((a, b) => {
    const ia = options.findIndex((o) => o.toLowerCase() === a.subject.toLowerCase());
    const ib = options.findIndex((o) => o.toLowerCase() === b.subject.toLowerCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.subject.localeCompare(b.subject);
  });
}

export function findLinkedSyllabusNote(
  plan: ClassPlan,
  category: TaskCategory,
  title: string
): SyllabusNoteEntry | null {
  const entries = getSyllabusNotesList(plan);
  if (entries.length === 0) return null;

  const titleLower = title.toLowerCase();

  // Direct title match first (e.g. "Fiqh", "Aqaaid", "Seerah")
  const direct = entries.find(
    (e) =>
      e.subject.toLowerCase() === titleLower ||
      titleLower.includes(e.subject.toLowerCase()) ||
      e.subject.toLowerCase().includes(titleLower)
  );
  if (direct) return direct;

  if (category === 'quran') {
    const readingLabel = getReadingSubjectLabel(plan).toLowerCase();
    return (
      entries.find((e) => {
        const s = e.subject.toLowerCase();
        return (
          s === readingLabel ||
          s.includes('quran') ||
          s.includes('qaidah') ||
          s.includes('juzz')
        );
      }) ?? null
    );
  }
  if (category === 'tajweed') {
    return entries.find((e) => e.subject.toLowerCase().includes('tajweed')) ?? null;
  }
  if (category === 'surah') {
    return entries.find((e) => e.subject.toLowerCase().includes('surah')) ?? null;
  }
  if (category === 'duas') {
    return entries.find((e) => e.subject.toLowerCase().includes('dua')) ?? null;
  }
  return null;
}

export interface ParsedSyllabusDraft {
  id: string;
  classPlanId: string;
  className: string;
  teacherName: string;
  subject: string;
  content: string;
  sourceFile: string;
}

function matchPlanFromRow(
  plans: ClassPlan[],
  rawClass: string,
  rawTeacher: string,
  fallbackPlan: ClassPlan
): ClassPlan {
  const cNorm = rawClass.trim().toLowerCase();
  const tNorm = rawTeacher.trim().toLowerCase();
  if (!cNorm && !tNorm) return fallbackPlan;

  const exactBoth = plans.find(
    (p) =>
      (!cNorm || p.className.toLowerCase() === cNorm) &&
      (!tNorm || p.teacherName.toLowerCase() === tNorm)
  );
  if (exactBoth) return exactBoth;

  if (cNorm) {
    const classMatches = plans.filter(
      (p) =>
        p.className.toLowerCase() === cNorm ||
        p.className.toLowerCase().includes(cNorm) ||
        cNorm.includes(p.className.toLowerCase())
    );
    if (classMatches.length === 1) return classMatches[0];
    if (classMatches.length > 1 && tNorm) {
      const narrowed = classMatches.find(
        (p) =>
          p.teacherName.toLowerCase().includes(tNorm) ||
          tNorm.includes(p.teacherName.toLowerCase())
      );
      if (narrowed) return narrowed;
    }
    if (classMatches.length > 0) return classMatches[0];
  }

  return fallbackPlan;
}

function formatGenericSheetRows(rows: string[][]): string {
  if (rows.length === 0) return '';
  if (rows.length === 1) {
    return rows[0].filter(Boolean).join(' · ');
  }

  const header = rows[0];
  const looksLikeHeader =
    header.length >= 2 &&
    header.some((h) =>
      /\b(topic|title|subject|note|syllabus|page|question|answer|detail|lesson|unit|summary|point)\b/i.test(
        h
      )
    );

  const dataRows = looksLikeHeader ? rows.slice(1) : rows;
  const lines: string[] = [];

  for (const row of dataRows) {
    const nonEmpty = row
      .map((cell, idx) => ({ cell: cell.trim(), header: header[idx]?.trim() || '' }))
      .filter((x) => x.cell.length > 0);

    if (nonEmpty.length === 0) continue;

    if (nonEmpty.length === 1) {
      lines.push(`• ${nonEmpty[0].cell}`);
    } else if (looksLikeHeader && nonEmpty.length === 2) {
      lines.push(`• ${nonEmpty[0].cell}: ${nonEmpty[1].cell}`);
    } else if (looksLikeHeader) {
      const [first, ...rest] = nonEmpty;
      const tail = rest.map((r) => (r.header ? `${r.header}: ${r.cell}` : r.cell)).join(' | ');
      lines.push(`• ${first.cell} — ${tail}`);
    } else {
      lines.push(`• ${nonEmpty.map((x) => x.cell).join(' — ')}`);
    }
  }

  return lines.join('\n');
}

function detectSheetSubjectName(sheetName: string, plan: ClassPlan): string | null {
  const lower = sheetName.trim().toLowerCase();
  if (!lower || /^sheet\d+$/i.test(lower)) return null;
  const known = [
    ...STANDARD_ISLAMIC_SUBJECTS,
    'Tajweed & Makhraj',
    'Tajweed',
    'Surahs',
    'Surah',
    'Quran',
    'Qaidah',
    "Juzz 'Amma",
    'Panj Para',
  ];
  for (const cand of known) {
    if (lower === cand.toLowerCase() || lower.includes(cand.toLowerCase())) {
      return normalizeSyllabusSubject(cand, plan);
    }
  }
  return null;
}

export function parseSyllabusSheetsToDrafts(
  sheets: Array<{ name: string; csvText: string }>,
  plans: ClassPlan[],
  fallbackPlanId: string,
  fallbackSubject: string,
  sourceFile: string
): ParsedSyllabusDraft[] {
  const fallbackPlan = plans.find((p) => p.id === fallbackPlanId) ?? plans[0];
  if (!fallbackPlan) return [];

  const buckets = new Map<
    string,
    { plan: ClassPlan; subject: string; chunks: string[] }
  >();

  const pushBucket = (plan: ClassPlan, subject: string, chunk: string) => {
    const cleanChunk = chunk.trim();
    if (!cleanChunk) return;
    const key = `${plan.id}::${subject.toLowerCase()}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.chunks.push(cleanChunk);
    } else {
      buckets.set(key, { plan, subject, chunks: [cleanChunk] });
    }
  };

  for (const sheet of sheets) {
    const rows = parseCsvRows(sheet.csvText);
    if (rows.length === 0) continue;

    const header = rows[0].map((c) => c.trim().toLowerCase());
    const subjectIdx = header.findIndex((h) =>
      /\b(subject|module|book|section|category)\b/.test(h)
    );
    const classIdx = header.findIndex((h) =>
      /\b(class|class name|grade|year|which class)\b/.test(h)
    );
    const teacherIdx = header.findIndex((h) =>
      /\b(teacher|ustadh|apa|instructor)\b/.test(h)
    );
    const topicIdx = header.findIndex((h) =>
      /\b(topic|unit|chapter|lesson|heading|title)\b/.test(h)
    );
    const noteIndices = header
      .map((h, i) => ({ h, i }))
      .filter(
        ({ h, i }) =>
          i !== subjectIdx &&
          i !== classIdx &&
          i !== teacherIdx &&
          /\b(syllabus|notes?|content|details?|summary|revision|guide|points?|key|answer|objective|page)\b/.test(
            h
          )
      )
      .map((x) => x.i);

    if (subjectIdx !== -1 && rows.length > 1) {
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const rawSub = row[subjectIdx]?.trim() || '';
        const targetPlan = matchPlanFromRow(
          plans,
          classIdx !== -1 ? row[classIdx] || '' : '',
          teacherIdx !== -1 ? row[teacherIdx] || '' : '',
          fallbackPlan
        );
        const subject = rawSub
          ? normalizeSyllabusSubject(rawSub, targetPlan)
          : detectSheetSubjectName(sheet.name, targetPlan) || fallbackSubject;

        const chosenNoteCols =
          noteIndices.length > 0
            ? noteIndices
            : row
                .map((_, idx) => idx)
                .filter(
                  (idx) =>
                    idx !== subjectIdx &&
                    idx !== classIdx &&
                    idx !== teacherIdx &&
                    idx !== topicIdx
                );

        const topicText = topicIdx !== -1 ? row[topicIdx]?.trim() || '' : '';
        const bodyParts = chosenNoteCols
          .map((idx) => ({
            label: rows[0][idx]?.trim() || '',
            val: row[idx]?.trim() || '',
          }))
          .filter((x) => x.val.length > 0)
          .map((x) =>
            chosenNoteCols.length > 1 && x.label ? `${x.label}: ${x.val}` : x.val
          );

        const line =
          topicText && bodyParts.length > 0
            ? `• ${topicText}: ${bodyParts.join(' · ')}`
            : topicText
              ? `• ${topicText}`
              : bodyParts.length > 0
                ? `• ${bodyParts.join(' · ')}`
                : '';

        pushBucket(targetPlan, subject, line);
      }
      continue;
    }

    // Fallback: Tab-per-subject or single-subject table formatted cleanly
    const sheetSubject =
      sheets.length > 1
        ? detectSheetSubjectName(sheet.name, fallbackPlan) || fallbackSubject
        : fallbackSubject;
    const formatted = formatGenericSheetRows(rows);
    pushBucket(fallbackPlan, sheetSubject, formatted);
  }

  return Array.from(buckets.entries()).map(([key, item]) => ({
    id: key,
    classPlanId: item.plan.id,
    className: item.plan.className,
    teacherName: item.plan.teacherName,
    subject: item.subject,
    content: item.chunks.join('\n'),
    sourceFile,
  }));
}
