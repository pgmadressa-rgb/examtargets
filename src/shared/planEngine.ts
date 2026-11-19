import type {
  ClassPlan,
  ClassTargets,
  CsvParseResult,
  DateRange,
  RevisionDay,
  RevisionTask,
  TaskCategory,
  TrackType,
} from './types.ts';

export const DEFAULT_DATE_RANGE: DateRange = {
  startDate: '2026-12-01',
  endDate: '2026-12-14',
};

const EMPTY_VALUES = new Set(['', 'na', 'n/a', 'none', 'nil', '-', 'no']);

export function cleanCell(val: string | undefined): string {
  if (!val) return '';
  return val.replace(/\r\n/g, '\n').trim();
}

export function isMeaningful(val: string | undefined): boolean {
  const c = cleanCell(val);
  if (!c) return false;
  return !EMPTY_VALUES.has(c.toLowerCase());
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'class';
}

/**
 * Parses RFC-4180 CSV or tab-separated spreadsheet paste (TSV) supporting quoted multiline cells.
 */
function detectDelimiter(text: string): ',' | '\t' {
  let inQuotes = false;
  let commas = 0;
  let tabs = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (ch === '\n' || ch === '\r') break;
      if (ch === ',') commas++;
      else if (ch === '\t') tabs++;
    }
  }
  return tabs > 0 && tabs >= commas ? '\t' : ',';
}

export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const text = csvText.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(cell);
        cell = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

const MONTH_NAME_TO_NUM: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

/**
 * Extracts YYYY-MM from timestamps in UK DD/MM/YYYY, DD/MM/YY, DD-MM-YYYY,
 * ISO YYYY-MM-DD, or written month formats (e.g. 12 Nov 2026).
 */
export function extractYearMonth(timestamp: string): string | null {
  const trimmed = timestamp.trim();
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[1]}-${String(Number(isoMatch[2])).padStart(2, '0')}`;
  }
  const slashMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(trimmed);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const rawYear = slashMatch[3];
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    // UK DD/MM/YYYY format used throughout the form responses
    // (12/11/2026, 17/11/2026 = November; 08/05/2026..18/05/2026 = May)
    const month = second >= 1 && second <= 12 ? second : first;
    return `${year}-${String(month).padStart(2, '0')}`;
  }
  const monthTextMatch = /\b([a-zA-Z]{3,9})\b[\s,.-]+(?:\d{1,2}[\s,.-]+)?(\d{4})\b/.exec(trimmed);
  if (monthTextMatch) {
    const m = MONTH_NAME_TO_NUM[monthTextMatch[1].toLowerCase()];
    if (m) return `${monthTextMatch[2]}-${m}`;
  }
  return null;
}

export function normalizeTrackType(raw: string): TrackType {
  const lower = raw.toLowerCase();
  if (lower.includes('islamic studies')) return 'Islamic Studies Only';
  if (lower.includes('qaidah')) return 'Qaidah';
  if (lower.includes('juzz') || lower.includes('juz')) return "Juzz 'Amma";
  return 'Quran/Panj Para';
}

function normalizeClassComparisonKey(name: string): string {
  return cleanCell(name)
    .toLowerCase()
    .replace(/\b(class|year|yr)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

function areSameClassName(a: string, b: string): boolean {
  const ka = normalizeClassComparisonKey(a);
  const kb = normalizeClassComparisonKey(b);
  if (!ka || !kb) return false;
  return ka === kb;
}

export function enumerateDates(range: DateRange): Array<{ date: string; weekday: string; dayIndex: number; dow: number }> {
  const start = new Date(`${range.startDate}T12:00:00Z`);
  const end = new Date(`${range.endDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return enumerateDates(DEFAULT_DATE_RANGE);
  }
  const result: Array<{ date: string; weekday: string; dayIndex: number; dow: number }> = [];
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cur = new Date(start);
  let idx = 1;
  // Cap at 42 days to guard against accidental huge date spans
  while (cur <= end && idx <= 42) {
    const yyyy = cur.getUTCFullYear();
    const mm = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(cur.getUTCDate()).padStart(2, '0');
    const dow = cur.getUTCDay();
    result.push({
      date: `${yyyy}-${mm}-${dd}`,
      weekday: weekdays[dow],
      dayIndex: idx,
      dow,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
    idx++;
  }
  return result;
}

function parsePageRange(text: string): { start: number; end: number } | null {
  const cleaned = text.replace(/\n/g, ' ');
  const rangeMatch = /(?:pages?|pg\.?)\s*(\d+)\s*(?:-|to|until)\s*(?:pages?|pg\.?)?\s*(\d+)/i.exec(cleaned);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (b >= a && b <= 900) return { start: a, end: b };
  }
  const untilMatch = /(?:until|upto|up to|end of)\s*(?:page|pg\.?)?\s*(\d+)/i.exec(cleaned);
  if (untilMatch) {
    const end = Number(untilMatch[1]);
    if (end >= 2 && end <= 300) return { start: 1, end };
  }
  const singlePageMatch = /^page\s*(\d+)$/i.exec(cleaned.trim());
  if (singlePageMatch) {
    const end = Number(singlePageMatch[1]);
    if (end >= 2 && end <= 300) return { start: 1, end };
  }
  return null;
}

function parseDailyPageCount(quota: string): number | null {
  const lower = quota.toLowerCase();
  if (lower.includes('one page')) return 1;
  const match = /(\d+)\s*(?:pages?|sides?)/i.exec(quota);
  if (match) return Number(match[1]);
  const numOnly = /^(\d+)$/.exec(quota.trim());
  if (numOnly) return Number(numOnly[1]);
  return null;
}

function splitTajweedRules(raw: string): string[] {
  if (!isMeaningful(raw)) return [];
  const norm = raw
    .replace(/[\n•]+/g, ',')
    .replace(/\+/g, ',')
    .replace(/\band\b/gi, ',');
  const parts = norm
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && !EMPTY_VALUES.has(s.toLowerCase()));
  return parts.length > 0 ? parts : [raw.trim()];
}

function parseAqaaidSections(raw: string): Array<{ title: string; start: number; end: number }> {
  const sections: Array<{ title: string; start: number; end: number }> = [];
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = /^(.+?)\s+pages?\s*(\d+)\s*-\s*(\d+)/i.exec(line);
    if (m) {
      sections.push({ title: m[1].trim(), start: Number(m[2]), end: Number(m[3]) });
    }
  }
  return sections;
}

export function detectGroups(targets: ClassTargets): string[] {
  const combined = `${targets.islamicStudies.fiqh}\n${targets.islamicStudies.revisionPlanNote}`;
  const hasG1 = /group\s*1/i.test(combined);
  const hasG2 = /group\s*2/i.test(combined);
  if (hasG1 && hasG2) return ['Group 1', 'Group 2'];
  return [];
}

function makeTask(
  slug: string,
  dayIndex: number,
  seq: number,
  category: TaskCategory,
  title: string,
  detail: string,
  group?: string
): RevisionTask {
  return {
    id: `${slug}-d${dayIndex}-${category}-${seq}`,
    category,
    title,
    detail,
    ...(group ? { group } : {}),
  };
}

/**
 * Generates a personalised day-by-day revision schedule from teacher inputs for any custom date range.
 * Respects explicit weekday/weekend teacher rules (e.g. Saliha Patel, Apa Habiba F, Apa Fatima Booster)
 * and divides page ranges / topics cleanly across the available days.
 */
export function generateDailySchedule(
  slug: string,
  trackType: TrackType,
  targets: ClassTargets,
  range: DateRange
): RevisionDay[] {
  const days = enumerateDates(range);
  const totalDays = days.length;
  const tajweedList = splitTajweedRules(targets.tajweedMakhraj);
  const quranPages = parsePageRange(targets.quranOrQaidah);
  const dailyQuranPages = parseDailyPageCount(targets.quranDailyQuota);
  const isNote = targets.islamicStudies.revisionPlanNote;
  const surahNote = `${targets.surahTargets}\n${targets.surahDailyQuota}`;
  const groups = detectGroups(targets);

  // Collect structured Islamic Studies subjects that have real targets
  const subjectEntries: Array<{ name: string; target: string; pages: { start: number; end: number } | null }> = [];
  const isTargets = targets.islamicStudies;
  const rawSubjects: Array<[string, string]> = [
    ['Fiqh', isTargets.fiqh],
    ['Aqaaid', isTargets.aqaaid],
    ['Seerah', isTargets.seerah],
    ['Hadith', isTargets.hadith],
    ['Adaab', isTargets.adaab],
    ['Islamic History', isTargets.islamicHistory],
    ['Akhlaaq', isTargets.akhlaaq],
  ];
  for (const [name, val] of rawSubjects) {
    if (isMeaningful(val)) {
      subjectEntries.push({ name, target: cleanCell(val), pages: parsePageRange(val) });
    }
  }

  // Check for explicit weekday rules in teacher's Islamic Studies plan
  const hasSalihaStyleSchedule =
    /monday\s*[-–]/i.test(isNote) && /tuesday\s*[-–]/i.test(isNote) && /wednesday\s*[-–]/i.test(isNote);
  const hasHabibaStyleSchedule =
    /monday\s*\+?\s*tuesday/i.test(isNote) && /wednesday\s*\+?\s*thursday/i.test(isNote);
  const hasThursdayFridayKahf = /baqarah.*kahf.*thursday.*friday/i.test(surahNote.replace(/\n/g, ' '));
  const hasWeekendSajdah = /sajdah.*saturday.*sunday/i.test(surahNote.replace(/\n/g, ' '));
  const aqaaidSections = parseAqaaidSections(isTargets.aqaaid);

  // Pre-build 5-pages-per-day chunk list when Aqaaid has detailed multi-section page blocks (e.g. Class 9)
  const aqaaidChunks: string[] = [];
  if (aqaaidSections.length > 0) {
    const step = dailyQuranPages && dailyQuranPages > 0 ? dailyQuranPages : 5;
    for (const sec of aqaaidSections) {
      for (let p = sec.start; p <= sec.end; p += step) {
        const endP = Math.min(p + step - 1, sec.end);
        aqaaidChunks.push(`${sec.title}: pages ${p}–${endP}`);
      }
    }
  }

  return days.map((day, idx) => {
    const tasks: RevisionTask[] = [];
    let seq = 1;

    // 1. Quran / Juzz Amma / Qaidah daily block
    if (trackType !== 'Islamic Studies Only' && isMeaningful(targets.quranOrQaidah)) {
      let detail = targets.quranOrQaidah;
      if (quranPages) {
        const totalP = quranPages.end - quranPages.start + 1;
        const perDay = dailyQuranPages ?? Math.max(1, Math.ceil(totalP / Math.max(1, totalDays - 2)));
        const sliceStart = quranPages.start + ((idx * perDay) % totalP);
        const sliceEnd = Math.min(quranPages.end, sliceStart + perDay - 1);
        const passNum = Math.floor((idx * perDay) / totalP) + 1;
        detail = `Pages ${sliceStart}–${sliceEnd} (Pass ${passNum} · Target: ${targets.quranOrQaidah})`;
      } else if (isMeaningful(targets.quranDailyQuota)) {
        detail = `${targets.quranDailyQuota} · Scope: ${targets.quranOrQaidah}`;
      }
      const label =
        trackType === 'Qaidah'
          ? 'Qaidah Reading'
          : trackType === "Juzz 'Amma"
            ? "Juzz 'Amma Reading"
            : 'Quran / Panj Para Reading';
      tasks.push(makeTask(slug, day.dayIndex, seq++, 'quran', label, detail));
    }

    // 2. Tajweed + Makhraj daily focus (rotate rules cleanly so ADHD learners focus on 1-2 rules/day)
    if (tajweedList.length > 0 && trackType !== 'Islamic Studies Only') {
      const ruleA = tajweedList[idx % tajweedList.length];
      const ruleB = tajweedList.length > 2 ? tajweedList[(idx + 1) % tajweedList.length] : null;
      const focus = ruleB && ruleB !== ruleA ? `${ruleA} & ${ruleB}` : ruleA;
      tasks.push(
        makeTask(
          slug,
          day.dayIndex,
          seq++,
          'tajweed',
          'Tajweed & Makhraj Focus',
          `Apply ${focus} carefully during today's recitation.`
        )
      );
    }

    // 3. Surahs & Memorisation block
    if (isMeaningful(targets.surahTargets) && trackType !== 'Islamic Studies Only') {
      if (hasThursdayFridayKahf || hasWeekendSajdah) {
        const extraParts: string[] = ['Surah Mulk + Surah Yaseen + 4 Juz Amma Surahs'];
        if (day.dow === 4 || day.dow === 5) {
          extraParts.push('Surah Baqarah (last page) & Surah Kahf (1st & last 10 ayahs)');
        }
        if (day.dow === 0 || day.dow === 6) {
          extraParts.push('Surah Sajdah');
        }
        tasks.push(
          makeTask(slug, day.dayIndex, seq++, 'surah', 'Surah Memorisation', extraParts.join(' · '))
        );
      } else {
        const quota = isMeaningful(targets.surahDailyQuota)
          ? targets.surahDailyQuota
          : 'Revise target surahs';
        tasks.push(
          makeTask(
            slug,
            day.dayIndex,
            seq++,
            'surah',
            'Surah Revision',
            `${quota} · From: ${targets.surahTargets.replace(/\n/g, ', ')}`
          )
        );
      }
    }

    // 4. Islamic Studies & Duas block
    if (isTargets.enabled) {
      if (groups.length > 0) {
        // Booster Group 1 & Group 2 structured tasks
        const isWeekend = day.dow === 0 || day.dow === 6;
        const g1Topics = ['Fiqh: Rulings to Wudhu (Book 4)', 'Aqaaid: Imaan to Holy Books (Book 4)', 'Life of Prophet s.a.w (Half Book)', 'Akhlaaq/Adaab: Eating & Drinking to Sabr'];
        const g2FiqhAqaaid = ['Water & Impurities (Book 6)', 'Maturity & Ghusl (Book 6)', 'Ahlus Sunnah & Nabawiyyat', 'Sahabahs & Asharah Mubasharah'];
        const g2Sirah = ['Shamaa’il (Week 1)', 'Abu Bakr r.a & his life (Weeks 2–4)'];
        const g2Tarikh = ['Prophet Dawud a.s', 'Prophet Suleyman a.s', 'Prophet Yunus a.s'];
        const g2Akhlaaq = ['Oppression & Bullying', 'Envy & Ghibah', 'Pride & Sunnah'];

        const weekIdx = Math.floor(idx / 7);
        tasks.push(
          makeTask(
            slug,
            day.dayIndex,
            seq++,
            'islamic-studies',
            isWeekend ? 'Group 1: Weekend 2-Topic Review' : 'Group 1: Daily Topic Revision',
            `${g1Topics[idx % g1Topics.length]} — read notes & self-quiz`,
            'Group 1'
          )
        );
        tasks.push(
          makeTask(
            slug,
            day.dayIndex,
            seq++,
            'islamic-studies',
            'Group 2: Fiqh & Aqaaid Focus',
            g2FiqhAqaaid[idx % g2FiqhAqaaid.length],
            'Group 2'
          )
        );
        tasks.push(
          makeTask(
            slug,
            day.dayIndex,
            seq++,
            'islamic-studies',
            'Group 2: Sirah, Tarikh & Akhlaaq',
            `${g2Sirah[Math.min(weekIdx, 1)]} · Tarikh: ${g2Tarikh[weekIdx % g2Tarikh.length]} · Akhlaaq: ${g2Akhlaaq[idx % g2Akhlaaq.length]}`,
            'Group 2'
          )
        );
        if (isMeaningful(isTargets.duas)) {
          tasks.push(
            makeTask(slug, day.dayIndex, seq++, 'duas', 'Personal Dua Target', isTargets.duas)
          );
        }
      } else if (hasSalihaStyleSchedule) {
        // Explicit Mon-Fri teacher timetable + Weekend consolidation
        const mapByDow: Record<number, { cat: TaskCategory; title: string; detail: string }> = {
          1: {
            cat: 'duas',
            title: 'Monday Duas & Meanings',
            detail: `Revise Duas (${isTargets.duas || 'Reception to Year 7 with meaning'})`,
          },
          2: {
            cat: 'islamic-studies',
            title: 'Tuesday Fiqh & 99 Names',
            detail: `${isTargets.fiqh || 'Fiqh target pages'} + 99 Names of Allah`,
          },
          3: {
            cat: 'islamic-studies',
            title: 'Wednesday Shamail & Sirah',
            detail: isTargets.seerah || 'Shamail & Sirah target pages',
          },
          4: {
            cat: 'islamic-studies',
            title: 'Thursday Aqaaid & Duas',
            detail: `${isTargets.aqaaid || 'Aqaaid target pages'} + daily Dua review`,
          },
          5: {
            cat: 'islamic-studies',
            title: 'Friday Akhlaaq & Tarikh',
            detail: 'Revise 2 pages each of Akhlaaq and Tarikh',
          },
          6: {
            cat: 'islamic-studies',
            title: 'Saturday Self-Quiz & Recap',
            detail: 'Test tricky topics from Mon–Fri Fiqh, Aqaaid & Sirah.',
          },
          0: {
            cat: 'duas',
            title: 'Sunday Duas & Readiness Check',
            detail: 'Oral recap of Duas with meanings + 99 Names of Allah.',
          },
        };
        const plan = mapByDow[day.dow];
        tasks.push(makeTask(slug, day.dayIndex, seq++, plan.cat, plan.title, plan.detail));
      } else if (hasHabibaStyleSchedule) {
        if (day.dow === 1 || day.dow === 2) {
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'duas',
              `${day.weekday} Dua Plan`,
              'Year 3 Duas revision + Dua when entering shopping area'
            )
          );
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'islamic-studies',
              day.dow === 1 ? 'Fiqh Revision' : 'Aqaaid Revision',
              day.dow === 1 ? isTargets.fiqh : isTargets.aqaaid
            )
          );
        } else if (day.dow === 3 || day.dow === 4) {
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'duas',
              `${day.weekday} Dua Plan`,
              'Year 4 Duas revision + meanings'
            )
          );
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'islamic-studies',
              day.dow === 3 ? 'Seerah Revision' : 'Fiqh & Aqaaid Recap',
              day.dow === 3 ? isTargets.seerah : `${isTargets.fiqh} · ${isTargets.aqaaid}`
            )
          );
        } else if (day.dow === 5) {
          tasks.push(
            makeTask(slug, day.dayIndex, seq++, 'duas', 'Friday Dua Plan', 'Year 5 Duas revision')
          );
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'islamic-studies',
              'Friday Seerah & Aqaaid Check',
              `${isTargets.seerah} · ${isTargets.aqaaid}`
            )
          );
        } else {
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'duas',
              'Weekend Dua & Names Consolidation',
              'Reception to Year 2 Duas + Names of Allah + Full Duas recap'
            )
          );
        }
      } else if (aqaaidChunks.length > 0) {
        // Class 9 style multi-section pages (5 pages/day)
        const chunk = aqaaidChunks[idx % aqaaidChunks.length];
        tasks.push(
          makeTask(
            slug,
            day.dayIndex,
            seq++,
            'islamic-studies',
            'Islamic Curriculum (5 Pages Daily)',
            chunk
          )
        );
        if (isMeaningful(targets.surahTargets)) {
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'duas',
              'Duas & Names of Allah',
              'Revise Reception to Year 9 Duas & All Names of Allah'
            )
          );
        }
      } else {
        // Generic clean distribution across numeric page ranges or subject list
        if (subjectEntries.length > 0) {
          // Pick 1-2 subjects per day rotating cleanly, plus page slices if numeric ranges exist
          const primarySub = subjectEntries[idx % subjectEntries.length];
          const secondarySub =
            subjectEntries.length > 1
              ? subjectEntries[(idx + 1) % subjectEntries.length]
              : null;

          const formatSub = (sub: { name: string; target: string; pages: { start: number; end: number } | null }) => {
            if (!sub.pages) return `${sub.name}: ${sub.target}`;
            const len = sub.pages.end - sub.pages.start + 1;
            const daysForSub = Math.max(2, Math.floor(totalDays / Math.min(subjectEntries.length, 3)));
            const perChunk = Math.max(2, Math.ceil(len / daysForSub));
            const offset = Math.floor(idx / subjectEntries.length) * perChunk;
            const s = sub.pages.start + (offset % len);
            const e = Math.min(sub.pages.end, s + perChunk - 1);
            return `${sub.name}: Pages ${s}–${e} (Full target: ${sub.target})`;
          };

          const detailParts = [formatSub(primarySub)];
          if (secondarySub && secondarySub.name !== primarySub.name) {
            detailParts.push(formatSub(secondarySub));
          }
          if (isNote && /15 min/i.test(isNote)) {
            detailParts.push('Minimum 15 mins per subject');
          } else if (isNote && /quiz/i.test(isNote) && (day.dow === 0 || day.dow === 6)) {
            detailParts.push('Weekend mini-quiz on covered pages');
          }

          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'islamic-studies',
              'Islamic Studies Focus',
              detailParts.join(' · ')
            )
          );
        } else {
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'islamic-studies',
              'Islamic Studies Review',
              isNote || 'Review class chapters and worksheet questions with parent/guardian.'
            )
          );
        }

        if (isMeaningful(isTargets.duas)) {
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'duas',
              'Daily Duas & Names Practice',
              isTargets.duas.replace(/\n/g, ' · ')
            )
          );
        }
      }
    }

    return {
      date: day.date,
      weekday: day.weekday,
      dayIndex: day.dayIndex,
      tasks,
    };
  });
}

export function normalizeTeacherKey(name: string): string {
  return cleanCell(name).toLowerCase().replace(/\s+/g, ' ');
}

export interface TeacherClassGroup {
  teacherKey: string;
  teacherName: string;
  plans: ClassPlan[];
}

export function groupPlansByTeacher(plans: ClassPlan[]): TeacherClassGroup[] {
  const map = new Map<string, TeacherClassGroup>();
  for (const plan of plans) {
    const cleanTeacher = cleanCell(plan.teacherName) || 'Unassigned Teacher';
    const key = normalizeTeacherKey(cleanTeacher) || 'unassigned';
    const existing = map.get(key);
    if (existing) {
      existing.plans.push(plan);
    } else {
      map.set(key, {
        teacherKey: key,
        teacherName: cleanTeacher,
        plans: [plan],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.teacherName.localeCompare(b.teacherName, 'en-GB', { sensitivity: 'base' })
  );
}

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

export function formatOrdinalDate(iso: string, options: { includeYear?: boolean; shortMonth?: boolean } = {}): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const dayNum = d.getUTCDate();
  const month = d.toLocaleDateString('en-GB', {
    month: options.shortMonth ? 'short' : 'long',
    timeZone: 'UTC',
  });
  const year = options.includeYear ? ` ${d.getUTCFullYear()}` : '';
  return `${weekday} ${dayNum}${ordinalSuffix(dayNum)} ${month}${year}`;
}

export interface RevisionWeekGroup {
  weekNumber: number;
  title: string;
  days: RevisionDay[];
}

/**
 * Filters schedule days to Mon–Fri weekdays by default (or keeps Sat/Sun when includeWeekends=true)
 * and groups them cleanly into Week 1, Week 2, Week 3... starting a new week each Monday.
 */
export function groupDaysIntoWeeks(
  days: RevisionDay[],
  includeWeekends = false
): RevisionWeekGroup[] {
  const filtered = includeWeekends
    ? days
    : days.filter((d) => {
        const dt = new Date(`${d.date}T12:00:00Z`);
        const dow = dt.getUTCDay();
        return dow >= 1 && dow <= 5;
      });

  if (filtered.length === 0) return [];

  const groups: RevisionDay[][] = [];
  let current: RevisionDay[] = [];

  for (const day of filtered) {
    const dt = new Date(`${day.date}T12:00:00Z`);
    const dow = dt.getUTCDay();
    if (current.length > 0 && dow === 1) {
      groups.push(current);
      current = [];
    }
    current.push(day);
  }
  if (current.length > 0) groups.push(current);

  return groups.map((weekDays, idx) => {
    const first = weekDays[0];
    const last = weekDays[weekDays.length - 1];
    const startLabel = formatOrdinalDate(first.date, { includeYear: true }).toUpperCase();
    const endLabel = formatOrdinalDate(last.date, { includeYear: true }).toUpperCase();
    return {
      weekNumber: idx + 1,
      title:
        weekDays.length === 1
          ? `WEEK ${idx + 1}: ${startLabel}`
          : `WEEK ${idx + 1}: ${startLabel} TO ${endLabel}`,
      days: weekDays,
    };
  });
}

interface ColumnMap {
  timestamp: number;
  teacher: number;
  class1: number;
  isClass: number;
  class2: number;
  track: number;
  quranTarget: number;
  tajweed: number;
  surahTargets: number;
  quranDaily: number;
  surahDaily: number;
  isEnabled: number;
  fiqh: number;
  aqaaid: number;
  seerah: number;
  hadith: number;
  adaab: number;
  islamicHistory: number;
  akhlaaq: number;
  duas: number;
  revisionPlan: number;
  // Optional secondary-class overrides when updated forms place Class 2 targets on the same row
  class2Track: number;
  class2QuranTarget: number;
  class2Tajweed: number;
  class2SurahTargets: number;
  class2QuranDaily: number;
  class2SurahDaily: number;
  class2IsEnabled: number;
  class2RevisionPlan: number;
  mappedIndices: Set<number>;
}

function buildColumnMap(headerRow: string[]): ColumnMap {
  const norm = headerRow.map((h) => cleanCell(h).toLowerCase().replace(/\s+/g, ' '));
  const used = new Set<number>();

  const matchCol = (predicates: Array<(h: string) => boolean>): number => {
    for (const pred of predicates) {
      const idx = norm.findIndex((h, i) => !used.has(i) && pred(h));
      if (idx >= 0) {
        used.add(idx);
        return idx;
      }
    }
    return -1;
  };

  const withFallback = (matchedIdx: number, fallback: number): number => {
    if (matchedIdx >= 0) return matchedIdx;
    const isClassicForm = norm.length >= 18;
    if (isClassicForm && fallback >= 0 && fallback < norm.length && !used.has(fallback)) {
      used.add(fallback);
      return fallback;
    }
    return -1;
  };

  const isSecondaryHeader = (h: string) =>
    /(class\s*2|2nd\s*class|second\s*class|class\s*two)/i.test(h);

  // Pass 1: Match primary class, track, and Islamic Studies toggle BEFORE secondary class column
  const mTimestamp = matchCol([(h) => h.includes('timestamp') || h === 'date']);
  const mTeacher = matchCol([
    (h) => h.includes('ustadh') || h.includes('apa') || h.includes('teacher'),
  ]);
  const mClass1 = matchCol([
    (h) =>
      !isSecondaryHeader(h) &&
      (h.includes('which class') || h.includes('class no') || h === 'class' || h.includes('class 1')),
  ]);
  const mTrack = matchCol([
    (h) => !isSecondaryHeader(h) && (h.includes('quran or qaidah') || h.includes('track')),
  ]);
  const mIsEnabled = matchCol([
    (h) => !isSecondaryHeader(h) && h.includes('islamic studies class'),
  ]);
  const class2 = matchCol([
    (h) =>
      isSecondaryHeader(h) &&
      !h.includes('target') &&
      !h.includes('surah') &&
      !h.includes('quran') &&
      !h.includes('plan') &&
      !h.includes('tajweed'),
  ]);
  // Matches the second "Which Class (one per form)?" column right after "Islamic Studies Class?"
  const isClass = matchCol([
    (h) =>
      !isSecondaryHeader(h) &&
      (h.includes('which class') ||
        h.includes('class no') ||
        h === 'class' ||
        h.includes('islamic studies class') ||
        h.includes('is class')),
  ]);
  const mQuranTarget = matchCol([
    (h) =>
      !isSecondaryHeader(h) &&
      (h.includes('exam target') || (h.includes('quran') && h.includes('target'))),
  ]);
  const mTajweed = matchCol([
    (h) => !isSecondaryHeader(h) && (h.includes('tajweed') || h.includes('makhraj')),
  ]);
  const mSurahTargets = matchCol([
    (h) => !isSecondaryHeader(h) && h.includes('surah') && h.includes('target'),
  ]);
  const mQuranDaily = matchCol([
    (h) =>
      !isSecondaryHeader(h) && h.includes('quran') && (h.includes('per day') || h.includes('daily')),
  ]);
  const mSurahDaily = matchCol([
    (h) =>
      !isSecondaryHeader(h) && h.includes('surah') && (h.includes('per day') || h.includes('daily')),
  ]);
  const mFiqh = matchCol([(h) => !isSecondaryHeader(h) && h.includes('fiqh')]);
  const mAqaaid = matchCol([
    (h) => !isSecondaryHeader(h) && (h.includes('aqaaid') || h.includes('aqaid') || h.includes('aqeedah')),
  ]);
  const mSeerah = matchCol([
    (h) => !isSecondaryHeader(h) && (h.includes('seerah') || h.includes('sirah')),
  ]);
  const mHadith = matchCol([(h) => !isSecondaryHeader(h) && h.includes('hadith')]);
  const mAdaab = matchCol([(h) => !isSecondaryHeader(h) && h.includes('adaab')]);
  const mIslamicHistory = matchCol([
    (h) => !isSecondaryHeader(h) && (h.includes('history') || h.includes('tarikh')),
  ]);
  const mAkhlaaq = matchCol([(h) => !isSecondaryHeader(h) && h.includes('akhlaaq')]);
  const mDuas = matchCol([
    (h) => !isSecondaryHeader(h) && h.includes('dua') && !h.includes('revision plan'),
  ]);
  const mRevisionPlan = matchCol([
    (h) =>
      !isSecondaryHeader(h) &&
      (h.includes('revision plan') || h.includes('islamic studies/ duas')),
  ]);

  // Secondary class target columns if present in updated form schemas
  const class2Track = matchCol([
    (h) => isSecondaryHeader(h) && (h.includes('quran or qaidah') || h.includes('track')),
  ]);
  const class2QuranTarget = matchCol([
    (h) =>
      isSecondaryHeader(h) &&
      (h.includes('exam target') || h.includes('quran') || h.includes('qaidah')),
  ]);
  const class2Tajweed = matchCol([
    (h) => isSecondaryHeader(h) && (h.includes('tajweed') || h.includes('makhraj')),
  ]);
  const class2SurahTargets = matchCol([
    (h) =>
      isSecondaryHeader(h) && h.includes('surah') && !h.includes('per day') && !h.includes('daily'),
  ]);
  const class2QuranDaily = matchCol([
    (h) =>
      isSecondaryHeader(h) && h.includes('quran') && (h.includes('per day') || h.includes('daily')),
  ]);
  const class2SurahDaily = matchCol([
    (h) =>
      isSecondaryHeader(h) && h.includes('surah') && (h.includes('per day') || h.includes('daily')),
  ]);
  const class2IsEnabled = matchCol([
    (h) => isSecondaryHeader(h) && h.includes('islamic studies') && !h.includes('plan'),
  ]);
  const class2RevisionPlan = matchCol([
    (h) => isSecondaryHeader(h) && (h.includes('revision plan') || h.includes('note')),
  ]);

  // Pass 2: Apply positional fallbacks only for classic 18+ column form exports
  const timestamp = withFallback(mTimestamp, 0);
  const teacher = withFallback(mTeacher, 1);
  const class1 = withFallback(mClass1, 2);
  const track = withFallback(mTrack, 3);
  const quranTarget = withFallback(mQuranTarget, 4);
  const tajweed = withFallback(mTajweed, 5);
  const surahTargets = withFallback(mSurahTargets, 6);
  const quranDaily = withFallback(mQuranDaily, 7);
  const surahDaily = withFallback(mSurahDaily, 8);
  const isEnabled = withFallback(mIsEnabled, 9);
  const fiqh = withFallback(mFiqh, 10);
  const aqaaid = withFallback(mAqaaid, 11);
  const seerah = withFallback(mSeerah, 12);
  const hadith = withFallback(mHadith, 13);
  const adaab = withFallback(mAdaab, 14);
  const islamicHistory = withFallback(mIslamicHistory, 15);
  const akhlaaq = withFallback(mAkhlaaq, 16);
  const duas = withFallback(mDuas, 17);
  const revisionPlan = withFallback(mRevisionPlan, 18);

  return {
    timestamp,
    teacher,
    class1,
    isClass,
    class2,
    track,
    quranTarget,
    tajweed,
    surahTargets,
    quranDaily,
    surahDaily,
    isEnabled,
    fiqh,
    aqaaid,
    seerah,
    hadith,
    adaab,
    islamicHistory,
    akhlaaq,
    duas,
    revisionPlan,
    class2Track,
    class2QuranTarget,
    class2Tajweed,
    class2SurahTargets,
    class2QuranDaily,
    class2SurahDaily,
    class2IsEnabled,
    class2RevisionPlan,
    mappedIndices: used,
  };
}

function getCell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return '';
  return cleanCell(row[idx]);
}

export function parseMadrasahRows(
  rows: string[][],
  options: { onlyNovember2026?: boolean; dateRange?: DateRange } = {}
): CsvParseResult {
  const onlyNov = options.onlyNovember2026 ?? true;
  const dateRange = options.dateRange ?? DEFAULT_DATE_RANGE;
  if (rows.length <= 1) {
    return { plans: [], totalRows: 0, includedCount: 0, skippedCount: 0, skippedSampleTimestamps: [] };
  }

  const headerRow = rows[0];
  const col = buildColumnMap(headerRow);
  const dataRows = rows.slice(1).filter((r) => r.some((c) => cleanCell(c).length > 0));
  const plans: ClassPlan[] = [];
  const usedSlugs = new Set<string>();
  const skippedSamples: string[] = [];
  let skippedCount = 0;

  const pushClassPlan = (params: {
    timestamp: string;
    submittedMonth: string;
    teacherName: string;
    className: string;
    trackType: TrackType;
    targets: ClassTargets;
  }) => {
    const baseSlug = slugify(`${params.teacherName}-${params.className}`);
    let slug = baseSlug;
    let counter = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    usedSlugs.add(slug);

    const groups = detectGroups(params.targets);
    const dailySchedule = generateDailySchedule(slug, params.trackType, params.targets, dateRange);

    plans.push({
      id: `plan-${slug}`,
      slug,
      timestamp: params.timestamp,
      submittedMonth: params.submittedMonth,
      teacherName: params.teacherName,
      className: params.className,
      trackType: params.trackType,
      targets: params.targets,
      groups,
      dateRange: { ...dateRange },
      dailySchedule,
      manuallyEdited: false,
    });
  };

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const timestamp = getCell(r, col.timestamp);
    const teacherName = getCell(r, col.teacher);
    const quranClassName = getCell(r, col.class1);
    const isClassName = getCell(r, col.isClass);
    if (!teacherName && !quranClassName && !isClassName) continue;

    const ym = extractYearMonth(timestamp);
    if (onlyNov && ym !== '2026-11') {
      skippedCount++;
      if (skippedSamples.length < 4 && timestamp) {
        skippedSamples.push(timestamp);
      }
      continue;
    }

    const extraNotes: Array<{ label: string; value: string }> = [];
    for (let c = 0; c < headerRow.length; c++) {
      if (col.mappedIndices.has(c)) continue;
      const label = cleanCell(headerRow[c]);
      const val = getCell(r, c);
      if (label && isMeaningful(val)) {
        extraNotes.push({ label, value: val });
      }
    }

    const trackRaw = getCell(r, col.track);
    const trackType = normalizeTrackType(trackRaw);
    const part1IsIslamicOnly = trackType === 'Islamic Studies Only';
    const isCellLower = getCell(r, col.isEnabled).toLowerCase();
    const isExplicitYes = isCellLower.startsWith('y');
    const isExplicitNo = isCellLower.startsWith('n');

    const islamicStudiesFields = {
      fiqh: getCell(r, col.fiqh),
      aqaaid: getCell(r, col.aqaaid),
      seerah: getCell(r, col.seerah),
      hadith: getCell(r, col.hadith),
      adaab: getCell(r, col.adaab),
      islamicHistory: getCell(r, col.islamicHistory),
      akhlaaq: getCell(r, col.akhlaaq),
      duas: getCell(r, col.duas),
      revisionPlanNote: getCell(r, col.revisionPlan),
    };
    const emptyIslamicStudies = {
      enabled: false,
      fiqh: '',
      aqaaid: '',
      seerah: '',
      hadith: '',
      adaab: '',
      islamicHistory: '',
      akhlaaq: '',
      duas: '',
      revisionPlanNote: '',
    };
    const hasMeaningfulIsFields = Object.values(islamicStudiesFields).some((v) => isMeaningful(v));
    const hasIslamicStudiesSection =
      part1IsIslamicOnly || isExplicitYes || (!isExplicitNo && hasMeaningfulIsFields);

    const hasSeparateIsClass =
      !part1IsIslamicOnly &&
      hasIslamicStudiesSection &&
      isMeaningful(isClassName) &&
      (!isMeaningful(quranClassName) || !areSameClassName(quranClassName, isClassName));

    const primaryClassName = part1IsIslamicOnly
      ? quranClassName || isClassName || 'Main Class'
      : quranClassName || 'Main Class';

    const primaryTargets: ClassTargets = {
      quranOrQaidah: part1IsIslamicOnly ? 'NA' : getCell(r, col.quranTarget) || 'NA',
      tajweedMakhraj: part1IsIslamicOnly ? 'NA' : getCell(r, col.tajweed) || 'NA',
      surahTargets: part1IsIslamicOnly ? 'NA' : getCell(r, col.surahTargets) || 'NA',
      quranDailyQuota: part1IsIslamicOnly ? 'NA' : getCell(r, col.quranDaily) || 'NA',
      surahDailyQuota: part1IsIslamicOnly ? 'NA' : getCell(r, col.surahDaily) || 'NA',
      islamicStudies: hasSeparateIsClass
        ? emptyIslamicStudies
        : {
            enabled: part1IsIslamicOnly || isExplicitYes || hasMeaningfulIsFields,
            ...islamicStudiesFields,
          },
      ...(extraNotes.length > 0 ? { extraNotes } : {}),
    };

    if (!hasSeparateIsClass || isMeaningful(quranClassName)) {
      pushClassPlan({
        timestamp,
        submittedMonth: ym ?? '2026-11',
        teacherName,
        className: primaryClassName,
        trackType,
        targets: primaryTargets,
      });
    }

    // Split separate Islamic Studies class from Part 2 ("Islamic Studies Class?" -> Yes + second "Which Class?")
    if (hasSeparateIsClass) {
      pushClassPlan({
        timestamp,
        submittedMonth: ym ?? '2026-11',
        teacherName,
        className: isClassName,
        trackType: 'Islamic Studies Only',
        targets: {
          quranOrQaidah: 'NA',
          tajweedMakhraj: 'NA',
          surahTargets: 'NA',
          quranDailyQuota: 'NA',
          surahDailyQuota: 'NA',
          islamicStudies: {
            enabled: true,
            ...islamicStudiesFields,
          },
          ...(extraNotes.length > 0 ? { extraNotes } : {}),
        },
      });
    }

    // Support explicit secondary class columns ("Class 2", "Second Class") if present on custom forms
    const secondClassName = getCell(r, col.class2);
    if (isMeaningful(secondClassName)) {
      const c2Track = isMeaningful(getCell(r, col.class2Track))
        ? normalizeTrackType(getCell(r, col.class2Track))
        : trackType;
      const c2IsRaw = getCell(r, col.class2IsEnabled);
      const c2IsEnabled = c2IsRaw ? c2IsRaw.toLowerCase().startsWith('y') : isExplicitYes;

      const c2Targets: ClassTargets = {
        quranOrQaidah: getCell(r, col.class2QuranTarget) || primaryTargets.quranOrQaidah,
        tajweedMakhraj: getCell(r, col.class2Tajweed) || primaryTargets.tajweedMakhraj,
        surahTargets: getCell(r, col.class2SurahTargets) || primaryTargets.surahTargets,
        quranDailyQuota: getCell(r, col.class2QuranDaily) || primaryTargets.quranDailyQuota,
        surahDailyQuota: getCell(r, col.class2SurahDaily) || primaryTargets.surahDailyQuota,
        islamicStudies: {
          enabled: c2IsEnabled,
          ...islamicStudiesFields,
          revisionPlanNote:
            getCell(r, col.class2RevisionPlan) || islamicStudiesFields.revisionPlanNote,
        },
        ...(extraNotes.length > 0 ? { extraNotes } : {}),
      };

      pushClassPlan({
        timestamp,
        submittedMonth: ym ?? '2026-11',
        teacherName,
        className: secondClassName,
        trackType: c2Track,
        targets: c2Targets,
      });
    }
  }

  return {
    plans,
    totalRows: dataRows.length,
    includedCount: plans.length,
    skippedCount,
    skippedSampleTimestamps: skippedSamples,
  };
}

export function parseMadrasahCsv(
  csvText: string,
  options: { onlyNovember2026?: boolean; dateRange?: DateRange } = {}
): CsvParseResult {
  const rows = parseCsvRows(csvText);
  return parseMadrasahRows(rows, options);
}
