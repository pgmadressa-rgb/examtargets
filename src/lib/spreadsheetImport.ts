import * as XLSX from 'xlsx';

export interface ImportedSheet {
  name: string;
  csvText: string;
  rowCount: number;
}

export interface ParsedSpreadsheetResult {
  isWorkbook: boolean;
  sheets: ImportedSheet[];
  defaultSheetName: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateParts(y: number, m: number, d: number, H = 0, M = 0, S = 0): string {
  const datePart = `${pad2(d)}/${pad2(m)}/${y}`;
  if (H === 0 && M === 0 && S === 0) return datePart;
  return `${datePart} ${pad2(H)}:${pad2(M)}:${pad2(S)}`;
}

function escapeCsvCell(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

function isDateLikeHeader(header: string): boolean {
  const h = header.toLowerCase();
  return h.includes('timestamp') || h.includes('date') || h.includes('submitted');
}

function extractSheetRows(sheet: XLSX.WorkSheet): string[][] {
  const ref = sheet['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows: string[][] = [];
  const dateCols = new Set<number>();

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr] as XLSX.CellObject | undefined;
      let text = '';

      if (cell) {
        const forceDateCheck = r > range.s.r && dateCols.has(c);
        if (cell.t === 'd' && cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) {
          text = formatDateParts(
            cell.v.getUTCFullYear(),
            cell.v.getUTCMonth() + 1,
            cell.v.getUTCDate(),
            cell.v.getUTCHours(),
            cell.v.getUTCMinutes(),
            cell.v.getUTCSeconds()
          );
        } else if (
          cell.t === 'n' &&
          typeof cell.v === 'number' &&
          ((typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) ||
            (forceDateCheck && cell.v > 30000 && cell.v < 80000))
        ) {
          const parsed = XLSX.SSF.parse_date_code(cell.v);
          if (parsed && parsed.y > 1900 && parsed.m >= 1 && parsed.d >= 1) {
            text = formatDateParts(parsed.y, parsed.m, parsed.d, parsed.H, parsed.M, parsed.S);
          } else {
            text = cell.w !== undefined ? String(cell.w) : String(cell.v);
          }
        } else if (cell.w !== undefined && cell.t !== 's') {
          text = String(cell.w);
        } else if (cell.v !== undefined && cell.v !== null) {
          text = String(cell.v);
        }
      }

      if (r === range.s.r && isDateLikeHeader(text)) {
        dateCols.add(c);
      }
      row.push(text.trim());
    }

    if (row.some((v) => v.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function scoreHeaderRow(firstRow: string[] | undefined): number {
  if (!firstRow) return 0;
  const joined = firstRow.join(' ').toLowerCase();
  let score = 0;
  if (joined.includes('timestamp')) score += 3;
  if (joined.includes('ustadh') || joined.includes('apa') || joined.includes('teacher')) score += 3;
  if (joined.includes('class')) score += 2;
  if (joined.includes('quran') || joined.includes('qaidah') || joined.includes('surah')) score += 2;
  return score;
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheetResult> {
  const lowerName = file.name.toLowerCase();
  const isDelimitedText =
    lowerName.endsWith('.csv') ||
    lowerName.endsWith('.tsv') ||
    lowerName.endsWith('.txt') ||
    file.type === 'text/csv' ||
    file.type === 'text/tab-separated-values';

  if (isDelimitedText) {
    const text = await file.text();
    const rowCount = text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length;
    return {
      isWorkbook: false,
      sheets: [{ name: file.name, csvText: text, rowCount }],
      defaultSheetName: file.name,
    };
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: false,
    cellNF: true,
  });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('The uploaded Excel workbook contains no sheets.');
  }

  const sheets: ImportedSheet[] = [];
  let bestSheetName = workbook.SheetNames[0];
  let bestScore = -1;

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const rows = extractSheetRows(worksheet);
    const csvText = rowsToCsv(rows);
    const headerScore = scoreHeaderRow(rows[0]);
    sheets.push({
      name: sheetName,
      csvText,
      rowCount: rows.length,
    });
    if (rows.length > 1 && headerScore > bestScore) {
      bestScore = headerScore;
      bestSheetName = sheetName;
    }
  }

  if (sheets.length === 0) {
    throw new Error('No readable worksheet data was found in this Excel file.');
  }

  return {
    isWorkbook: true,
    sheets,
    defaultSheetName: bestSheetName,
  };
}
