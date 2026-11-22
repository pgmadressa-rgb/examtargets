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

export const DEFAULT_QURAN_END_DATE = '2026-12-08';
export const DEFAULT_ISLAMIC_END_DATE = '2026-12-10';

export const DEFAULT_DATE_RANGE: DateRange = {
  startDate: '2026-11-23',
  endDate: DEFAULT_ISLAMIC_END_DATE,
  quranEndDate: DEFAULT_QURAN_END_DATE,
};

export function hasIslamicOrDuaTopics(trackType: TrackType, targets: ClassTargets): boolean {
  return (
    trackType === 'Islamic Studies Only' ||
    targets.islamicStudies.enabled ||
    isMeaningful(targets.islamicStudies.duas)
  );
}

export function resolvePlanDateRange(
  trackType: TrackType,
  targets: ClassTargets,
  baseRange: DateRange = DEFAULT_DATE_RANGE
): DateRange {
  const startDate = baseRange.startDate || DEFAULT_DATE_RANGE.startDate;
  const islamicEnd = baseRange.endDate || DEFAULT_ISLAMIC_END_DATE;
  const rawQuranEnd = baseRange.quranEndDate || islamicEnd;
  const quranEndDate = rawQuranEnd > islamicEnd ? islamicEnd : rawQuranEnd;

  if (!hasIslamicOrDuaTopics(trackType, targets)) {
    return {
      startDate,
      endDate: quranEndDate,
      quranEndDate,
    };
  }

  return {
    startDate,
    endDate: islamicEnd,
    quranEndDate,
  };
}

const EMPTY_VALUES = new Set(['', '.', '..', '...', 'na', 'n/a', 'none', 'nil', '-', '—', 'no']);

export function cleanCell(val: string | undefined): string {
  if (!val) return '';
  return val.replace(/\r\n/g, '\n').trim();
}

export function isMeaningful(val: string | undefined): boolean {
  const c = cleanCell(val);
  if (!c) return false;
  if (/^[.\-_—\s]+$/.test(c)) return false;
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

function parseNumberSet(text: string, allowImplicitQaidahSingle = false): number[] {
  const cleaned = text
    .replace(/\n/g, ' ')
    .replace(/\b(?:lesson|topic|year|yr|book|para|juz|juzz)\s*\d+(?:\s*[-–to]+\s*\d+)?/gi, ' ');

  const nums = new Set<number>();
  const addRange = (a: number, b: number) => {
    if (a < 1 || b > 900 || b < a) return;
    for (let n = a; n <= b; n++) nums.add(n);
  };

  // 1. Explicit "Page X - Y" or "Pg X to Pg Y"
  const prefixMatches = cleaned.matchAll(
    /(?:pages?|pgs?\.?)\s*(\d+)\s*(?:-|–|to|unt[a-z]{1,4})\s*(?:pages?|pgs?\.?)?\s*(\d+)/gi
  );
  for (const m of prefixMatches) {
    addRange(Number(m[1]), Number(m[2]));
  }

  // 2. Postfix "1 - 35 pg"
  const postfixMatches = cleaned.matchAll(
    /(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:pages?|pgs?\.?)\b/gi
  );
  for (const m of postfixMatches) {
    addRange(Number(m[1]), Number(m[2]));
  }

  // 3. "Until / end of page 28" (handles typos like "untik")
  if (nums.size === 0) {
    const untilMatch = /(?:unt[a-z]{1,4}|upto|up\s*to|end\s*of)\s*(?:page|pg\.?)?\s*(\d+)/i.exec(cleaned);
    if (untilMatch) {
      addRange(1, Number(untilMatch[1]));
    }
  }

  // 4. Parenthetical "(Page 24)"
  if (nums.size === 0) {
    const parenMatch = /\(\s*pages?\s*(\d+)\s*\)/i.exec(cleaned);
    if (parenMatch) {
      addRange(1, Number(parenMatch[1]));
    }
  }

  // 5. Bare numeric range with optional "& 48, 49" (e.g. "28 - 39 & 48, 49", "132 - 143")
  if (nums.size === 0) {
    const bareMatch = /^\s*(\d+)\s*(?:-|–|to)\s*(\d+)(.*)$/.exec(cleaned.trim());
    if (bareMatch) {
      addRange(Number(bareMatch[1]), Number(bareMatch[2]));
      const tail = bareMatch[3] || '';
      const extraSingles = tail.matchAll(/(?:&|,|\band\b)\s*(\d+)\b/gi);
      for (const em of extraSingles) {
        const val = Number(em[1]);
        if (val >= 1 && val <= 900) nums.add(val);
      }
    }
  }

  // 6. Standalone "Page N" (for Qaidah books e.g. "Page 29" means Pages 1-29)
  if (nums.size === 0) {
    const singlePageMatch = /\bpages?\s*(\d+)\b/i.exec(cleaned);
    if (singlePageMatch) {
      const n = Number(singlePageMatch[1]);
      if (allowImplicitQaidahSingle && n >= 8 && n <= 120) {
        addRange(1, n);
      } else if (n >= 1 && n <= 900) {
        nums.add(n);
      }
    }
  }

  return Array.from(nums).sort((a, b) => a - b);
}

function parsePageRange(text: string, allowImplicitQaidahSingle = false): { start: number; end: number } | null {
  const nums = parseNumberSet(text, allowImplicitQaidahSingle);
  if (nums.length < 2) return null;
  return { start: nums[0], end: nums[nums.length - 1] };
}

function formatPageNumbers(nums: number[]): string {
  if (nums.length === 0) return '';
  if (nums.length === 1) return `Page ${nums[0]}`;
  const ranges: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === prev + 1) {
      prev = nums[i];
    } else {
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = nums[i];
      prev = nums[i];
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
  return `Pages ${ranges.join(', ')}`;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function extractNumberToken(raw: string): number | null {
  const numM = /(\d+(?:\.\d+)?)/.exec(raw);
  if (numM) return Number(numM[1]);
  const words = raw.toLowerCase().split(/[^a-z]+/);
  for (const w of words) {
    if (WORD_NUMBERS[w] !== undefined) return WORD_NUMBERS[w];
  }
  return null;
}

function parseDailyPageCount(quota: string): number | null {
  const lower = quota.toLowerCase();
  if (lower.includes('1 side') || /\bone\s+side\b/i.test(lower)) return 1;
  const digitMatch = /(\d+(?:\.\d+)?)\s*(?:pages?|pgs?|sides?|rukus?)/i.exec(quota);
  if (digitMatch) return Number(digitMatch[1]);
  const wordMatch = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:pages?|pgs?|sides?)\b/i.exec(lower);
  if (wordMatch) return WORD_NUMBERS[wordMatch[1]] ?? null;
  const numOnly = /^(\d+(?:\.\d+)?)$/.exec(quota.trim());
  if (numOnly) return Number(numOnly[1]);
  return null;
}

const DEFAULT_TAJWEED_RULES = [
  'Noon Sakinah: Izhar & Idgham',
  'Noon Sakinah: Ikhfa & Iqlab',
  'Meem Sakinah & Ghunnah',
  'Qalqalah Letters',
  'Madd Asli & Madd Munfasil',
  'Madd Muttasil & Madd Lazim',
  'Heavy Letters (Tafkheem)',
  'Rules of Raa & Laam',
  'Throat Letters (Makhraj)',
];

function cleanTajweedLabel(raw: string): string {
  const s = raw
    .replace(/\bthort\b/gi, 'Throat')
    .replace(/\bingham\b/gi, 'Idgham')
    .replace(/\bikfah\b/gi, 'Ikhfa')
    .replace(/\biqlaab\b/gi, 'Iqlab')
    .replace(/\bizhaar\b/gi, 'Izhar')
    .replace(/\bgunnah\b/gi, 'Ghunnah')
    .replace(/\bqalqala\b/gi, 'Qalqalah')
    .replace(/\brull\b/gi, 'Rules')
    .replace(/\bmad\b/gi, 'Madd')
    .replace(/\bmudoods?\b/gi, 'Madd Rules')
    .replace(/\bmutasil\b/gi, 'Madd Muttasil')
    .replace(/\bmunfasil\b/gi, 'Madd Munfasil')
    .replace(/\blaazim\b/gi, 'Madd Lazim')
    .replace(/\b(madd\s+)+/gi, 'Madd ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function splitTajweedRules(raw: string): string[] {
  if (!isMeaningful(raw)) return [];
  const trimmedLower = raw.toLowerCase().trim();
  if (/^all\s+throat\s+letters$/i.test(trimmedLower)) {
    return ['Throat Letters (Makhraj)'];
  }
  if (
    /^(?:all(?:\s+(?:tajweed|rules))?|all\s*-\s*except\b.*|tajweed\s+covered.*|sheet\s+provided.*)$/i.test(
      trimmedLower
    ) ||
    trimmedLower.includes('all tajweed rules')
  ) {
    return DEFAULT_TAJWEED_RULES;
  }
  const norm = raw
    .replace(/[\n•()]+/g, ',')
    .replace(/\+/g, ',')
    .replace(/\band\b/gi, ',')
    .replace(/\b(noonsakin|noon sakin)\s*(?:,|and)?\s*(tanween)\s*rules?/gi, 'Noon Sakinah & Tanween')
    .replace(/\bmeem sakin rules?/gi, 'Meem Sakinah')
    .replace(/[-–]/g, ' ');
  const parts = norm
    .split(',')
    .map(cleanTajweedLabel)
    .filter((s) => s.length > 1 && !EMPTY_VALUES.has(s.toLowerCase()) && !/^rules?$/i.test(s));
  return parts.length > 0 ? parts : DEFAULT_TAJWEED_RULES.slice(0, 4);
}

const CANONICAL_SURAHS: Array<{ num: number; name: string; aliases: string[] }> = [
  { num: 1, name: 'Al-Fatihah', aliases: ['fatiha', 'faatihah', 'fatihah'] },
  { num: 78, name: 'An-Naba', aliases: ['naba'] },
  { num: 79, name: "An-Nazi'at", aliases: ['naziat', 'naaziaat'] },
  { num: 80, name: 'Abasa', aliases: ['abasa'] },
  { num: 81, name: 'At-Takwir', aliases: ['takwir', 'takweer'] },
  { num: 82, name: 'Al-Infitar', aliases: ['infitar', 'infitaar'] },
  { num: 83, name: 'Al-Mutaffifin', aliases: ['mutaffifin', 'mutaffifeen'] },
  { num: 84, name: 'Al-Inshiqaq', aliases: ['inshiqaq', 'inshiqaaq'] },
  { num: 85, name: 'Al-Buruj', aliases: ['buruj', 'burooj'] },
  { num: 86, name: 'At-Tariq', aliases: ['tariq', 'taariq'] },
  { num: 87, name: "Al-A'la", aliases: ['ala', 'alaa', 'aalaa'] },
  { num: 88, name: 'Al-Ghashiyah', aliases: ['ghashiyah', 'ghaashiyah'] },
  { num: 89, name: 'Al-Fajr', aliases: ['fajr'] },
  { num: 90, name: 'Al-Balad', aliases: ['balad'] },
  { num: 91, name: 'Ash-Shams', aliases: ['shams'] },
  { num: 92, name: 'Al-Layl', aliases: ['layl', 'lail'] },
  { num: 93, name: 'Ad-Duha', aliases: ['duha', 'dhuha', 'duhaa', 'dhuhaa'] },
  { num: 94, name: 'Ash-Sharh', aliases: ['sharh', 'inshirah', 'inshiraah'] },
  { num: 95, name: 'At-Tin', aliases: ['tin', 'teen'] },
  { num: 96, name: "Al-'Alaq", aliases: ['alaq'] },
  { num: 97, name: 'Al-Qadr', aliases: ['qadr'] },
  { num: 98, name: 'Al-Bayyinah', aliases: ['bayyinah', 'bayinah'] },
  { num: 99, name: 'Az-Zalzalah', aliases: ['zalzalah', 'zilzaal', 'zilzal'] },
  { num: 100, name: "Al-'Adiyat", aliases: ['adiyat', 'aadiyaat'] },
  { num: 101, name: "Al-Qari'ah", aliases: ['qariah', 'qaariah'] },
  { num: 102, name: 'At-Takathur', aliases: ['takathur', 'takaathur'] },
  { num: 103, name: "Al-'Asr", aliases: ['asr'] },
  { num: 104, name: 'Al-Humazah', aliases: ['humazah', 'humaza'] },
  { num: 105, name: 'Al-Fil', aliases: ['fil', 'feel'] },
  { num: 106, name: 'Quraysh', aliases: ['quraysh', 'quraish'] },
  { num: 107, name: "Al-Ma'un", aliases: ['maun', 'maoon', 'maaun'] },
  { num: 108, name: 'Al-Kawthar', aliases: ['kawthar', 'kauthar', 'kawsar'] },
  { num: 109, name: 'Al-Kafirun', aliases: ['kafirun', 'kafiroon', 'kaafiroon'] },
  { num: 110, name: 'An-Nasr', aliases: ['nasr'] },
  { num: 111, name: 'Al-Masad', aliases: ['masad', 'lahab'] },
  { num: 112, name: 'Al-Ikhlas', aliases: ['ikhlas', 'ikhlaas', 'ihklaas'] },
  { num: 113, name: 'Al-Falaq', aliases: ['falaq'] },
  { num: 114, name: 'An-Naas', aliases: ['naas', 'nas'] },
];

function findCanonicalSurahIndex(fragment: string): number {
  const norm = fragment
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/\b(surah|surahs|al|an|as|at|ad|az|ash|un|ul)\b/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();
  if (!norm) return -1;
  const words = norm.split(/\s+/);
  for (let i = CANONICAL_SURAHS.length - 1; i >= 0; i--) {
    const entry = CANONICAL_SURAHS[i];
    if (entry.aliases.some((alias) => words.includes(alias))) {
      return i;
    }
  }
  return -1;
}

function expandSurahList(raw: string): string[] {
  const flat = raw.replace(/\n/g, ' ').trim();
  const rangeRegex =
    /(?:surahs?\s+)?(?:al-|an-|as-|at-|ad-|az-|ash-|ul-|un-)?([a-z'’]+)\s*(?:-|–|to|till|until)\s*(?:surahs?\s+)?(?:al-|an-|as-|at-|ad-|az-|ash-|ul-|un-)?([a-z'’]+)/gi;

  const collected: string[] = [];
  const seen = new Set<string>();
  const addName = (label: string) => {
    if (!seen.has(label)) {
      seen.add(label);
      collected.push(label);
    }
  };

  for (const m of flat.matchAll(rangeRegex)) {
    const iA = findCanonicalSurahIndex(m[1]);
    const iB = findCanonicalSurahIndex(m[2]);
    if (iA >= 0 && iB >= 0) {
      if (iA === 0 && iB > 0) {
        addName(`Surah ${CANONICAL_SURAHS[0].name} (1)`);
        for (let k = CANONICAL_SURAHS.length - 1; k >= iB; k--) {
          addName(`Surah ${CANONICAL_SURAHS[k].name} (${CANONICAL_SURAHS[k].num})`);
        }
      } else {
        const step = iA <= iB ? 1 : -1;
        for (let k = iA; step > 0 ? k <= iB : k >= iB; k += step) {
          addName(`Surah ${CANONICAL_SURAHS[k].name} (${CANONICAL_SURAHS[k].num})`);
        }
      }
    }
  }

  // Also parse explicit line/comma/plus separated surahs (do not swallow newlines)
  const parts = raw.split(/[,+\n&]+|\band\b/i);
  for (const part of parts) {
    const rMatch = new RegExp(rangeRegex.source, 'i').exec(part);
    if (rMatch && findCanonicalSurahIndex(rMatch[1]) >= 0 && findCanonicalSurahIndex(rMatch[2]) >= 0) {
      continue;
    }
    const idx = findCanonicalSurahIndex(part);
    if (idx >= 0) {
      const s = CANONICAL_SURAHS[idx];
      addName(`Surah ${s.name} (${s.num})`);
    }
  }

  return collected;
}

function parseDailySurahCount(quota: string): number | null {
  const lower = quota.toLowerCase();
  if (/one\s+small.*one\s+big/i.test(lower)) return 2;
  if (/\bone\s+surah\b|\b1\s+surah\b|\b1\s+page\b/i.test(lower)) return 1;
  const m = /(\d+)\s*(?:small|short|big|long)?\s*(?:surahs?|short\s*surahs?|small\b)/i.exec(lower);
  if (m) return Number(m[1]);
  const w = extractNumberToken(lower);
  if (w !== null && /(?:surah|small|big|short|long)/i.test(lower)) return Math.round(w);
  const numOnly = /^(\d+)$/.exec(quota.trim());
  if (numOnly) return Number(numOnly[1]);
  return null;
}

const ARABIC_LETTERS_17 = [
  'Alif', 'Baa', 'Taa', 'Thaa', 'Jeem', 'Haa', 'Khaa', 'Daal', 'Dhaal',
  'Raa', 'Zaa', 'Seen', 'Sheen', 'Saad', 'Daad', 'Taa (heavy)', 'Zhuaa',
];
const ARABIC_LETTERS_28 = [
  'Alif', 'Baa', 'Taa', 'Thaa', 'Jeem', 'Haa', 'Khaa', 'Daal', 'Dhaal',
  'Raa', 'Zaa', 'Seen', 'Sheen', 'Saad', 'Daad', 'Taa', 'Zhuaa', 'Ayn',
  'Ghayn', 'Faa', 'Qaaf', 'Kaaf', 'Laam', 'Meem', 'Noon', 'Waw', 'Haa', 'Yaa',
];

function parseJuzRange(raw: string): { startJuz: number; endJuz: number } | null {
  const lower = raw.toLowerCase();
  if (/\bjuz\s*amma\b|\bjuzz\s*amma\b/i.test(lower)) {
    return { startJuz: 30, endJuz: 30 };
  }
  const ampMatch = /\bjuzz?\s*(\d+)\s*(?:&|,|and)\s*(\d+)\b/i.exec(lower);
  if (ampMatch) {
    return { startJuz: Number(ampMatch[1]), endJuz: Number(ampMatch[2]) };
  }
  const rangeMatch = /\b(?:juzz?|para)\s*(\d+)\s*(?:-|–|to|until)\s*(?:juzz?|para)?\s*(\d+)\b/i.exec(lower);
  if (rangeMatch) {
    return { startJuz: Number(rangeMatch[1]), endJuz: Number(rangeMatch[2]) };
  }
  const uptoMatch = /\b(?:juzz?|para)\s*(\d+)\s*(?:upto|up to|until)\b/i.exec(lower);
  if (uptoMatch) {
    return { startJuz: 1, endJuz: Number(uptoMatch[1]) };
  }
  const quarterMatch = /\(\s*(\d+)\s*juz\s*\).*?(\d+)\b/i.exec(lower);
  if (quarterMatch) {
    return { startJuz: Number(quarterMatch[1]), endJuz: Number(quarterMatch[2]) };
  }
  return null;
}

function formatJuzPageSlice(startJuz: number, endJuz: number, sliceOffset: number, count: number): string {
  const pagesPerJuz = startJuz === 30 && endJuz === 30 ? 24 : 20;
  const totalPages = (endJuz - startJuz + 1) * pagesPerJuz;
  const isWrap = sliceOffset >= totalPages;
  const s = sliceOffset % totalPages;
  const e = Math.min(totalPages - 1, s + Math.max(1, count) - 1);
  const sJuz = startJuz + Math.floor(s / pagesPerJuz);
  const sPg = (s % pagesPerJuz) + 1;
  const eJuz = startJuz + Math.floor(e / pagesPerJuz);
  const ePg = (e % pagesPerJuz) + 1;
  const prefix = isWrap ? 'Recap ' : '';
  if (startJuz === 30 && endJuz === 30) {
    return `${prefix}${sPg === ePg ? `Juz 'Amma Page ${sPg}` : `Juz 'Amma Pages ${sPg}–${ePg}`}`;
  }
  if (sJuz === eJuz) {
    return `${prefix}${sPg === ePg ? `Juz ${sJuz} · Page ${sPg}` : `Juz ${sJuz} · Pages ${sPg}–${ePg}`}`;
  }
  return `${prefix}Juz ${sJuz} Pg ${sPg} – Juz ${eJuz} Pg ${ePg}`;
}

function parseDuasBreakdown(raw: string): string[] {
  const cleaned = raw.trim();
  if (!isMeaningful(cleaned)) return [];
  const lower = cleaned.toLowerCase();

  if (lower.includes('every student on different')) {
    return ['Personal Dua (1 Dua/day)'];
  }

  const pageNums = parseNumberSet(cleaned);
  if (pageNums.length >= 2 && !/year\s*\d/i.test(cleaned)) {
    return pageNums.map((p) => `Duas Page ${p}`);
  }

  const items: string[] = [];
  const recRange = /\breception\s*(?:-|–|to)\s*(?:year|yr)\s*(\d+)/i.exec(cleaned);
  if (recRange) {
    items.push('Reception Duas');
    const maxYr = Number(recRange[1]);
    for (let y = 1; y <= maxYr; y++) items.push(`Year ${y} Duas`);
  }

  const yrRange = /\byear\s*(\d+)\s*(?:&|\band\b|-)\s*(\d+)/i.exec(cleaned);
  if (yrRange) {
    for (let y = Number(yrRange[1]); y <= Number(yrRange[2]); y++) {
      if (!items.includes(`Year ${y} Duas`)) items.push(`Year ${y} Duas`);
    }
  }
  const singleYrs = cleaned.matchAll(/\b(?:year|yr)\s*(\d+)\b/gi);
  for (const m of singleYrs) {
    const label = `Year ${m[1]} Duas`;
    if (!items.includes(label)) items.push(label);
  }
  if (/reception/i.test(lower) && !items.includes('Reception Duas')) {
    items.unshift('Reception Duas');
  }
  if (/until\s*(?:yr|year)\s*(\d+)/i.test(lower)) {
    const m = /until\s*(?:yr|year)\s*(\d+)/i.exec(lower);
    if (m) {
      const maxY = Number(m[1]);
      items.length = 0;
      items.push('Reception Duas');
      for (let y = 1; y <= maxY; y++) items.push(`Year ${y} Duas`);
    }
  }
  if (/kalimah/i.test(lower)) {
    items.push('Kalimahs (1–4)');
  }
  if (/dua\s*number\s*(\d+)/i.test(lower)) {
    const m = /dua\s*number\s*(\d+)/i.exec(lower);
    if (m) {
      const n = Number(m[1]);
      const hasNamesToAliyyu = /99\s*names|aliyyu/i.test(lower);
      const blocks = Math.ceil(n / 2);
      for (let b = 0; b < blocks; b++) {
        const d1 = b * 2 + 1;
        const d2 = Math.min(n, d1 + 1);
        const duaPart = d1 === d2 ? `Dua ${d1}` : `Duas ${d1}–${d2}`;
        if (hasNamesToAliyyu) {
          const nStart = b * 4 + 1;
          const nEnd = Math.min(37, (b + 1) * 4);
          const namesLabel = nStart === nEnd ? `Name ${nStart}` : `Names ${nStart}–${nEnd}`;
          items.push(nStart <= 37 ? `${duaPart} · ${namesLabel}` : duaPart);
        } else {
          items.push(duaPart);
        }
      }
    }
  } else if (/99\s*names|allah'?s\s*name|40\s*names/i.test(lower)) {
    const countMatch = /(\d+)\s*names/i.exec(lower);
    const totalNames = countMatch ? Number(countMatch[1]) : 99;
    const step = totalNames <= 40 ? 10 : 15;
    for (let i = 1; i <= totalNames; i += step) {
      items.push(`Names of Allah ${i}–${Math.min(totalNames, i + step - 1)}`);
    }
  }

  if (items.length > 0) return items;
  return cleaned
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => isMeaningful(s));
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
 * Generates a personalised day-by-day revision schedule with ONLY broken-down daily targets
 * (page numbers, juz/para slices, surah numbers, ayah blocks, lesson numbers, or rule focus).
 * Exam target notes stay outside the tracker.
 */
export function generateDailySchedule(
  slug: string,
  trackType: TrackType,
  targets: ClassTargets,
  range: DateRange
): RevisionDay[] {
  const days = enumerateDates(range);
  const weekdaySlots = days.filter((d) => d.dow >= 1 && d.dow <= 5);
  const totalWorkdays = Math.max(1, weekdaySlots.length > 0 ? weekdaySlots.length : days.length);

  const quranCutoffDate =
    range.quranEndDate && range.quranEndDate < range.endDate
      ? range.quranEndDate
      : range.endDate;
  const quranDays = days.filter((d) => d.date <= quranCutoffDate);
  const quranWeekdaySlots = quranDays.filter((d) => d.dow >= 1 && d.dow <= 5);
  const totalQuranWorkdays = Math.max(
    1,
    quranWeekdaySlots.length > 0 ? quranWeekdaySlots.length : Math.max(1, quranDays.length)
  );

  // Assign continuous 0..totalWorkdays-1 indices to weekdays so Mon-Fri schedules never skip pages
  let runningWorkIdx = 0;
  const daySlotIndices = days.map((d, idx) => {
    if (weekdaySlots.length === 0) return { isWeekend: false, slotIdx: idx };
    if (d.dow >= 1 && d.dow <= 5) {
      const slot = runningWorkIdx;
      runningWorkIdx++;
      return { isWeekend: false, slotIdx: slot };
    }
    return { isWeekend: true, slotIdx: Math.max(0, runningWorkIdx - 1) };
  });

  const tajweedList = splitTajweedRules(targets.tajweedMakhraj);
  const quranNums = parseNumberSet(targets.quranOrQaidah, trackType === 'Qaidah');
  const dailyQuranPages = parseDailyPageCount(targets.quranDailyQuota);
  const juzRange = parseJuzRange(targets.quranOrQaidah);
  const isNote = targets.islamicStudies.revisionPlanNote;
  const surahNote = `${targets.surahTargets}\n${targets.surahDailyQuota}`;
  const groups = detectGroups(targets);

  const expandedSurahs = isMeaningful(targets.surahTargets)
    ? expandSurahList(targets.surahTargets)
    : [];
  const dailySurahCount = parseDailySurahCount(targets.surahDailyQuota);
  const allSuratsEveryDay = /all\s+surat/i.test(targets.surahDailyQuota);
  const hasKahfFirst10 =
    /(?:kahaf?|kahf).*first\s*(?:10|&\s*last\s*10|and\s*last\s*10)|first\s*10.*(?:kahaf?|kahf)/i.test(
      targets.surahTargets
    );
  const hasKahfFirst12 = /first\s*12.*khaf|(?:kahaf?|kahf).*12/i.test(targets.surahTargets);
  const hasKahfLast10 =
    /last\s*10.*(?:kahaf?|kahf)|(?:kahaf?|kahf).*last\s*10/i.test(targets.surahTargets);
  const hasMulkExtra = /surah\s*mulk/i.test(targets.surahTargets);
  const hasBaqarahLast2 = /baqarah\s*last\s*2/i.test(targets.surahTargets);
  const hasHashrLast3 = /hashr\s*last\s*3/i.test(targets.surahTargets);

  // Structured Islamic Studies subjects
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
  const subjectEntries: Array<{
    name: string;
    target: string;
    pageNums: number[];
    lessons: { start: number; end: number } | null;
  }> = [];
  for (const [name, val] of rawSubjects) {
    if (isMeaningful(val)) {
      const cleaned = cleanCell(val);
      const lessonM = /\b(?:lesson|topic)\s*(\d+)\s*(?:-|–|to)\s*(\d+)/i.exec(cleaned);
      subjectEntries.push({
        name,
        target: cleaned,
        pageNums: parseNumberSet(cleaned, false),
        lessons: lessonM ? { start: Number(lessonM[1]), end: Number(lessonM[2]) } : null,
      });
    }
  }

  // Precompute per-subject appearance counters across all weekdays so every subject advances sequentially with zero repeats
  const subTotalAppearances: number[] = subjectEntries.map(() => 0);
  const subDaySlots: Array<{ primaryIdx: number; primaryApp: number; secondaryIdx: number; secondaryApp: number }> = [];
  if (subjectEntries.length > 0) {
    const N = subjectEntries.length;
    for (let w = 0; w < totalWorkdays; w++) {
      const pIdx = w % N;
      const pApp = subTotalAppearances[pIdx]++;
      let sIdx = -1;
      let sApp = 0;
      if (N > 1) {
        sIdx = (w + 1) % N;
        sApp = subTotalAppearances[sIdx]++;
      }
      subDaySlots.push({ primaryIdx: pIdx, primaryApp: pApp, secondaryIdx: sIdx, secondaryApp: sApp });
    }
  }

  const hasSalihaStyleSchedule =
    /monday\s*[-–]/i.test(isNote) && /tuesday\s*[-–]/i.test(isNote) && /wednesday\s*[-–]/i.test(isNote);
  const hasHabibaStyleSchedule =
    /monday\s*\+?\s*tuesday/i.test(isNote) && /wednesday\s*\+?\s*thursday/i.test(isNote);
  const hasThursdayFridayKahf = /baqarah.*kahf.*thursday.*friday/i.test(surahNote.replace(/\n/g, ' '));
  const hasWeekendSajdah = /sajdah.*saturday.*sunday/i.test(surahNote.replace(/\n/g, ' '));
  const aqaaidSections = parseAqaaidSections(isTargets.aqaaid);

  const aqaaidChunks: string[] = [];
  if (aqaaidSections.length > 0) {
    const isDailyPages = parseDailyPageCount(isTargets.revisionPlanNote);
    const step = isDailyPages && isDailyPages > 0 ? isDailyPages : 5;
    for (const sec of aqaaidSections) {
      for (let p = sec.start; p <= sec.end; p += step) {
        const endP = Math.min(p + step - 1, sec.end);
        aqaaidChunks.push(
          p === endP ? `${sec.title}: Page ${p}` : `${sec.title}: Pages ${p}–${endP}`
        );
      }
    }
  }

  const duaChunks = parseDuasBreakdown(isTargets.duas);

  return days.map((day, idx) => {
    const { isWeekend, slotIdx } = daySlotIndices[idx];
    const tasks: RevisionTask[] = [];
    let seq = 1;

    const includeQuranToday =
      trackType !== 'Islamic Studies Only' && day.date <= quranCutoffDate;

    // 1. Quran / Juzz 'Amma / Qaidah broken-down daily numbers (through quranCutoffDate e.g. 8 Dec)
    if (includeQuranToday && isMeaningful(targets.quranOrQaidah)) {
      const qLower = targets.quranOrQaidah.toLowerCase();
      const label =
        trackType === 'Qaidah'
          ? 'Qaidah Reading'
          : trackType === "Juzz 'Amma"
            ? "Juzz 'Amma Reading"
            : 'Quran / Panj Para Reading';
      let detail = '';

      if (qLower.includes('alif to zhuaa')) {
        const perDay = 2;
        const s = (slotIdx * perDay) % ARABIC_LETTERS_17.length;
        const e = Math.min(ARABIC_LETTERS_17.length - 1, s + perDay - 1);
        detail = `Page 4 · Letters ${ARABIC_LETTERS_17[s]} – ${ARABIC_LETTERS_17[e]}`;
      } else if (qLower.includes('alif to yaa') || /letters?\s*أ/i.test(qLower)) {
        const perDay = 3;
        const s = (slotIdx * perDay) % ARABIC_LETTERS_28.length;
        const e = Math.min(ARABIC_LETTERS_28.length - 1, s + perDay - 1);
        detail =
          s === e
            ? `Letter ${s + 1}: ${ARABIC_LETTERS_28[s]}`
            : `Letters ${s + 1}–${e + 1}: ${ARABIC_LETTERS_28[s]} – ${ARABIC_LETTERS_28[e]}`;
      } else if (qLower.includes('surah duha') && qLower.includes('a’laa') || (qLower.includes('duha') && qLower.includes('alaa'))) {
        // Surahs 93 back to 87 (142 ayahs total)
        const surahAyahs: Array<[string, number]> = [
          ['Ad-Duha', 11],
          ['Al-Layl', 21],
          ['Ash-Shams', 15],
          ['Al-Balad', 20],
          ['Al-Fajr', 30],
          ['Al-Ghashiyah', 26],
          ["Al-A'la", 19],
        ];
        const totalAyahs = surahAyahs.reduce((acc, s) => acc + s[1], 0);
        const perDay = 10;
        const startGlobal = (slotIdx * perDay) % totalAyahs;
        const endGlobal = Math.min(totalAyahs - 1, startGlobal + perDay - 1);
        const parts: string[] = [];
        let cursor = 0;
        for (const [sName, count] of surahAyahs) {
          const sEnd = cursor + count - 1;
          if (endGlobal >= cursor && startGlobal <= sEnd) {
            const fromAyah = Math.max(1, startGlobal - cursor + 1);
            const toAyah = Math.min(count, endGlobal - cursor + 1);
            parts.push(`${sName}: Ayahs ${fromAyah}–${toAyah}`);
          }
          cursor += count;
        }
        detail = isWeekend ? `Recap ${parts.join(' · ')}` : parts.join(' & ');
      } else if (qLower.includes('ma’idah') || qLower.includes('maidah')) {
        // Surah Al-Ma'idah (120 ayahs) + Al-An'am (1-41) = 161 ayahs
        const totalAyahs = 161;
        const perDay = Math.ceil(totalAyahs / totalQuranWorkdays);
        const startA = (slotIdx * perDay) % totalAyahs;
        const endA = Math.min(totalAyahs - 1, startA + perDay - 1);
        if (endA < 120) {
          detail = `Surah Al-Ma'idah: Ayahs ${startA + 1}–${endA + 1}`;
        } else if (startA >= 120) {
          detail = `Surah Al-An'am: Ayahs ${startA - 120 + 1}–${endA - 120 + 1}`;
        } else {
          detail = `Al-Ma'idah ${startA + 1}–120 & Al-An'am 1–${endA - 120 + 1}`;
        }
      } else if (quranNums.length >= 2) {
        const perDay = dailyQuranPages ?? Math.max(1, Math.ceil(quranNums.length / totalQuranWorkdays));
        const rawStart = Math.floor(slotIdx * perDay);
        const rawEnd = Math.max(rawStart, Math.floor((slotIdx + 1) * perDay) - 1);
        const span = Math.max(1, rawEnd - rawStart + 1);
        if (rawStart < quranNums.length) {
          const endIdx = Math.min(quranNums.length - 1, rawEnd);
          const slice = quranNums.slice(rawStart, endIdx + 1);
          const formatted = formatPageNumbers(slice);
          detail = isWeekend ? `Recap ${formatted}` : formatted;
        } else {
          const wrapStart = rawStart % quranNums.length;
          const wrapEnd = Math.min(quranNums.length - 1, wrapStart + span - 1);
          const slice = quranNums.slice(wrapStart, wrapEnd + 1);
          detail = `Recap ${formatPageNumbers(slice)}`;
        }
      } else if (juzRange) {
        if (/ruku/i.test(targets.quranDailyQuota)) {
          const rukuCount = parseDailyPageCount(targets.quranDailyQuota) ?? 3;
          const totalRukus = 36;
          const startR = ((slotIdx * rukuCount) % totalRukus) + 1;
          const endR = Math.min(totalRukus, startR + rukuCount - 1);
          const juzNum = juzRange.startJuz + Math.floor((startR - 1) / 16);
          const localStart = ((startR - 1) % 16) + 1;
          const localEnd = localStart + (endR - startR);
          detail = `Juz ${juzNum} · Rukus ${localStart}–${localEnd}`;
        } else {
          const pagesPerJuz = juzRange.startJuz === 30 && juzRange.endJuz === 30 ? 24 : 20;
          const totalJuzPages = (juzRange.endJuz - juzRange.startJuz + 1) * pagesPerJuz;
          const perDay =
            dailyQuranPages && !/1\s*side/i.test(targets.quranDailyQuota)
              ? dailyQuranPages
              : Math.max(2, Math.ceil(totalJuzPages / totalQuranWorkdays));
          detail = formatJuzPageSlice(juzRange.startJuz, juzRange.endJuz, slotIdx * perDay, perDay);
        }
      } else {
        const perDay = dailyQuranPages ?? 2;
        const startP = slotIdx * perDay + 1;
        const endP = startP + perDay - 1;
        detail = startP === endP ? `Page ${startP}` : `Pages ${startP}–${endP}`;
      }

      tasks.push(makeTask(slug, day.dayIndex, seq++, 'quran', label, detail));
    }

    // 2. Tajweed + Makhraj daily rule focus (pure rule name, through quranCutoffDate e.g. 8 Dec)
    if (tajweedList.length > 0 && includeQuranToday) {
      const ruleA = tajweedList[slotIdx % tajweedList.length];
      const ruleB = tajweedList.length > 3 ? tajweedList[(slotIdx + 1) % tajweedList.length] : null;
      const focus = ruleB && ruleB !== ruleA ? `${ruleA} & ${ruleB}` : ruleA;
      tasks.push(makeTask(slug, day.dayIndex, seq++, 'tajweed', 'Tajweed & Makhraj', focus));
    }

    // 3. Surahs broken down into daily numbers / Surah names (through quranCutoffDate e.g. 8 Dec)
    if (isMeaningful(targets.surahTargets) && includeQuranToday) {
      if (hasThursdayFridayKahf || hasWeekendSajdah) {
        const extraParts: string[] = ['Surah Al-Mulk · Surah Yaseen'];
        const juzSlice = expandedSurahs.length > 0
          ? expandedSurahs.slice((slotIdx * 4) % expandedSurahs.length, ((slotIdx * 4) % expandedSurahs.length) + 4)
          : ['4 Juz Amma Surahs'];
        extraParts.push(juzSlice.join(', '));
        if (day.dow === 4 || day.dow === 5) {
          extraParts.push('Baqarah (Last Page) & Kahf (First/Last 10 Ayahs)');
        }
        if (day.dow === 0 || day.dow === 6) {
          extraParts.push('Surah As-Sajdah');
        }
        tasks.push(
          makeTask(slug, day.dayIndex, seq++, 'surah', 'Surah Revision', extraParts.join(' · '))
        );
      } else if (/reception\s*to\s*year\s*9/i.test(targets.surahTargets)) {
        // Class 9 style "5 short surahs and 1 ruku"
        const baseShort = expandedSurahs.length > 0 ? expandedSurahs : CANONICAL_SURAHS.slice(16).map((s) => `Surah ${s.name}`);
        const sStart = (slotIdx * 5) % baseShort.length;
        const slice = Array.from({ length: 5 }, (_, k) => baseShort[(sStart + k) % baseShort.length]);
        tasks.push(
          makeTask(
            slug,
            day.dayIndex,
            seq++,
            'surah',
            'Surah Revision',
            `${slice[0]} – ${slice[slice.length - 1]} (5) · 1 Long Ruku`
          )
        );
      } else if (expandedSurahs.length > 0) {
        const perDay = allSuratsEveryDay
          ? Math.max(2, Math.ceil(expandedSurahs.length / totalQuranWorkdays))
          : dailySurahCount ?? Math.max(1, Math.ceil(expandedSurahs.length / totalQuranWorkdays));
        const startIdx = (slotIdx * perDay) % expandedSurahs.length;
        const slice = expandedSurahs.slice(startIdx, startIdx + perDay);
        const surahText =
          slice.length <= 2
            ? slice.join(' & ')
            : `${slice[0]} – ${slice[slice.length - 1]} (${slice.length} Surahs)`;

        const extras: string[] = [surahText];
        if (hasKahfFirst10) {
          const half = slotIdx % 2 === 0 ? 'Kahf Ayahs 1–5' : 'Kahf Ayahs 6–10';
          extras.push(hasKahfLast10 ? `${half} & Last 10` : half);
        } else if (hasKahfFirst12) {
          extras.push(slotIdx % 2 === 0 ? 'Kahf Ayahs 1–6' : 'Kahf Ayahs 7–12');
        }
        if (hasMulkExtra && !surahText.includes('Mulk')) {
          if (slotIdx % 3 === 0) extras.push('Surah Al-Mulk (Part 1)');
          else if (slotIdx % 3 === 1) extras.push('Surah Al-Mulk (Part 2)');
          else extras.push('Surah Al-Mulk (Full)');
        }
        if (hasBaqarahLast2 && slotIdx % 2 === 0) {
          extras.push('Al-Baqarah (Last 2 Ayahs)');
        }
        if (hasHashrLast3 && slotIdx % 2 === 1) {
          extras.push('Al-Hashr (Last 3 Ayahs)');
        }

        tasks.push(
          makeTask(slug, day.dayIndex, seq++, 'surah', 'Surah Revision', extras.join(' · '))
        );
      } else {
        tasks.push(
          makeTask(
            slug,
            day.dayIndex,
            seq++,
            'surah',
            'Surah Revision',
            `${
              dailySurahCount
                ? `${dailySurahCount} ${dailySurahCount === 1 ? 'Surah' : 'Surahs'}`
                : '1–2 Surahs'
            }`
          )
        );
      }
    }

    // 4. Islamic Studies & Duas broken down into concrete numbers / slices
    if (isTargets.enabled) {
      if (groups.length > 0) {
        const g1Topics = [
          'Fiqh Book 4: Topics 1–2 (Rulings & Cleanliness)',
          'Fiqh Book 4: Topics 3–4 (Wudhu)',
          'Aqaaid Book 4: Topics 1–2 (Imaan & Angels)',
          'Aqaaid Book 4: Topics 3–4 (Holy Books)',
          'Sirah Book: Part 1 (Chapters 1–3)',
          'Sirah Book: Part 2 (Chapters 4–6)',
          'Akhlaaq Book 4: Topics 1–2 (Eating & Drinking)',
          'Akhlaaq Book 4: Topics 3–4 (Sabr)',
        ];
        const g2FiqhAqaaid = [
          'Fiqh Book 6: Water & Impurities',
          'Fiqh Book 6: Maturity & Ghusl',
          'Aqaaid Book 6: Ahlus Sunnah & Nabawiyyat',
          'Aqaaid Book 6: Sahabahs & Asharah Mubasharah',
        ];
        const g2Sirah = ["Sirah Book 6: Shamaa'il", 'Sirah Book 6: Abu Bakr (r.a)'];
        const g2Tarikh = [
          'Tarikh: Prophet Dawud (a.s)',
          'Tarikh: Prophet Suleyman (a.s)',
          'Tarikh: Prophet Yunus (a.s)',
        ];
        const g2Akhlaaq = [
          'Akhlaaq: Oppression & Bullying',
          'Akhlaaq: Envy & Ghibah',
          'Akhlaaq: Pride & Sunnah',
        ];

        const weekIdx = Math.floor(slotIdx / 5);
        tasks.push(
          makeTask(
            slug,
            day.dayIndex,
            seq++,
            'islamic-studies',
            isWeekend ? 'Group 1: Recap (2 Topics)' : 'Group 1: Topic Revision',
            g1Topics[slotIdx % g1Topics.length],
            'Group 1'
          )
        );
        tasks.push(
          makeTask(
            slug,
            day.dayIndex,
            seq++,
            'islamic-studies',
            'Group 2: Fiqh & Aqaaid',
            g2FiqhAqaaid[slotIdx % g2FiqhAqaaid.length],
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
            `${g2Sirah[Math.min(weekIdx, 1)]} · ${g2Tarikh[weekIdx % g2Tarikh.length]} · ${g2Akhlaaq[slotIdx % g2Akhlaaq.length]}`,
            'Group 2'
          )
        );
        if (duaChunks.length > 0) {
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'duas',
              'Daily Dua',
              duaChunks[slotIdx % duaChunks.length]
            )
          );
        }
      } else if (hasSalihaStyleSchedule) {
        const fiqhNums = parseNumberSet(isTargets.fiqh);
        const aqNums = parseNumberSet(isTargets.aqaaid);
        const sirahNums = parseNumberSet(isTargets.seerah);
        const weekOffset = Math.floor(slotIdx / 5);

        const sliceForWeek = (nums: number[], fallback: string) => {
          if (nums.length < 2) return fallback;
          const half = Math.ceil(nums.length / 2);
          const slice = nums.slice((weekOffset % 2) * half, ((weekOffset % 2) + 1) * half);
          return formatPageNumbers(slice.length > 0 ? slice : nums);
        };

        const mapByDow: Record<number, { cat: TaskCategory; title: string; detail: string }> = {
          1: {
            cat: 'duas',
            title: 'Monday Duas',
            detail: duaChunks.length > 0 ? duaChunks[weekOffset % duaChunks.length] : 'Reception – Year 3 Duas',
          },
          2: {
            cat: 'islamic-studies',
            title: 'Tuesday Fiqh & Names',
            detail: `${sliceForWeek(fiqhNums, 'Fiqh Pages 28–37')} · 99 Names (${weekOffset % 2 === 0 ? '1–50' : '51–99'})`,
          },
          3: {
            cat: 'islamic-studies',
            title: 'Wednesday Shamail & Sirah',
            detail: sliceForWeek(sirahNums, 'Pages 82–92'),
          },
          4: {
            cat: 'islamic-studies',
            title: 'Thursday Aqaaid & Duas',
            detail: `${sliceForWeek(aqNums, 'Pages 132–146')} · ${duaChunks[(weekOffset + 2) % Math.max(1, duaChunks.length)] || 'Year 4–7 Duas'}`,
          },
          5: {
            cat: 'islamic-studies',
            title: 'Friday Akhlaaq & Tarikh',
            detail: `Akhlaaq: 2 Pages · Tarikh: 2 Pages`,
          },
          6: {
            cat: 'islamic-studies',
            title: 'Saturday Recap',
            detail: `${sliceForWeek(fiqhNums, 'Fiqh')} · ${sliceForWeek(aqNums, 'Aqaaid')}`,
          },
          0: {
            cat: 'duas',
            title: 'Sunday Duas & Names',
            detail: '99 Names of Allah · Duas (Years 1–7)',
          },
        };
        const planDay = mapByDow[day.dow];
        tasks.push(makeTask(slug, day.dayIndex, seq++, planDay.cat, planDay.title, planDay.detail));
      } else if (hasHabibaStyleSchedule) {
        if (day.dow === 1 || day.dow === 2) {
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'duas',
              `${day.weekday} Duas`,
              day.dow === 1 ? 'Year 3 Duas (Part 1)' : 'Year 3 Duas (Part 2)'
            )
          );
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'islamic-studies',
              day.dow === 1 ? 'Fiqh' : 'Aqaaid',
              day.dow === 1 ? 'Page 46' : 'Page 143'
            )
          );
        } else if (day.dow === 3 || day.dow === 4) {
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'duas',
              `${day.weekday} Duas`,
              day.dow === 3 ? 'Year 4 Duas (Part 1)' : 'Year 4 Duas (Part 2)'
            )
          );
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'islamic-studies',
              day.dow === 3 ? 'Seerah' : 'Fiqh & Aqaaid',
              day.dow === 3 ? 'Page 97' : 'Fiqh Page 46 · Aqaaid Page 143'
            )
          );
        } else if (day.dow === 5) {
          tasks.push(makeTask(slug, day.dayIndex, seq++, 'duas', 'Friday Duas', 'Year 5 Duas'));
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'islamic-studies',
              'Seerah & Aqaaid',
              'Seerah Page 97 · Aqaaid Page 143'
            )
          );
        } else {
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'duas',
              'Weekend Duas',
              day.dow === 6 ? 'Reception – Year 2 Duas' : '99 Names of Allah (1–99)'
            )
          );
        }
      } else if (aqaaidChunks.length > 0) {
        const chunk = aqaaidChunks[slotIdx % aqaaidChunks.length];
        tasks.push(
          makeTask(slug, day.dayIndex, seq++, 'islamic-studies', 'Islamic Curriculum', chunk)
        );
        if (isMeaningful(targets.surahTargets)) {
          const yrSlot = (slotIdx % 10);
          const duaDetail =
            yrSlot === 0
              ? 'Reception Duas · Names 1–10'
              : `Year ${yrSlot} Duas · Names ${yrSlot * 10 + 1}–${Math.min(99, (yrSlot + 1) * 10)}`;
          tasks.push(
            makeTask(slug, day.dayIndex, seq++, 'duas', 'Duas & 99 Names', duaDetail)
          );
        }
      } else {
        if (subjectEntries.length > 0) {
          const slotMeta = subDaySlots[slotIdx % subDaySlots.length];
          const primarySub = subjectEntries[slotMeta.primaryIdx];
          const secondarySub = slotMeta.secondaryIdx >= 0 ? subjectEntries[slotMeta.secondaryIdx] : null;

          const formatSubSlice = (
            sub: (typeof subjectEntries)[number],
            subAppearanceIdx: number,
            totalAppearances: number
          ): string => {
            if (sub.pageNums.length >= 2) {
              const total = sub.pageNums.length;
              const startIdx = Math.floor((subAppearanceIdx * total) / Math.max(1, totalAppearances));
              const endIdx = Math.max(
                startIdx,
                Math.min(total - 1, Math.floor(((subAppearanceIdx + 1) * total) / Math.max(1, totalAppearances)) - 1)
              );
              const slice = sub.pageNums.slice(startIdx, endIdx + 1);
              return `${sub.name}: ${formatPageNumbers(slice)}`;
            }
            if (sub.lessons) {
              const count = sub.lessons.end - sub.lessons.start + 1;
              if (count >= totalAppearances) {
                const sOff = Math.floor((subAppearanceIdx * count) / Math.max(1, totalAppearances));
                const eOff = Math.max(sOff, Math.floor(((subAppearanceIdx + 1) * count) / Math.max(1, totalAppearances)) - 1);
                const l1 = sub.lessons.start + sOff;
                const l2 = sub.lessons.start + eOff;
                return l1 === l2 ? `${sub.name}: Lesson ${l1}` : `${sub.name}: Lessons ${l1}–${l2}`;
              }
              const lessonNum = sub.lessons.start + (subAppearanceIdx % Math.max(1, count));
              return `${sub.name}: Lesson ${lessonNum}`;
            }
            const totalParts = Math.max(2, totalAppearances);
            const partNum = (subAppearanceIdx % totalParts) + 1;
            return `${sub.name}: Part ${partNum} of ${totalParts}`;
          };

          const detailParts = [
            formatSubSlice(
              primarySub,
              slotMeta.primaryApp,
              subTotalAppearances[slotMeta.primaryIdx]
            ),
          ];
          if (secondarySub && secondarySub.name !== primarySub.name) {
            detailParts.push(
              formatSubSlice(
                secondarySub,
                slotMeta.secondaryApp,
                subTotalAppearances[slotMeta.secondaryIdx]
              )
            );
          }

          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'islamic-studies',
              'Islamic Studies',
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
              'Islamic Studies',
              `Unit ${(slotIdx % 5) + 1}`
            )
          );
        }

        if (duaChunks.length > 0) {
          tasks.push(
            makeTask(
              slug,
              day.dayIndex,
              seq++,
              'duas',
              'Duas & Names',
              duaChunks[slotIdx % duaChunks.length]
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
    const planDateRange = resolvePlanDateRange(params.trackType, params.targets, dateRange);
    const dailySchedule = generateDailySchedule(slug, params.trackType, params.targets, planDateRange);

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
      dateRange: planDateRange,
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
