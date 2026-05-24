import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

const stationAliases = ['station', 'station name', 'service station', 'site', 'branch', 'station code'];
const dateAliases = ['date', 'sales date', 'transaction date', 'period'];
const revenueAliases = ['revenue', 'sales', 'net sales', 'amount', 'total revenue'];
const transactionAliases = ['transactions', 'transaction count', 'txn count', 'sales count', 'transactions count'];

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function parseHeaderMap(headers: string[]) {
  const map = new Map<string, string>();

  headers.forEach((header, index) => {
    const normalized = normalize(header);
    const matchKey =
      stationAliases.find((alias) => normalized.includes(alias)) ||
      dateAliases.find((alias) => normalized.includes(alias)) ||
      revenueAliases.find((alias) => normalized.includes(alias)) ||
      transactionAliases.find((alias) => normalized.includes(alias));

    if (!matchKey) {
      return;
    }

    if (stationAliases.includes(matchKey)) {
      map.set('station', String(index));
    }
    if (dateAliases.includes(matchKey)) {
      map.set('date', String(index));
    }
    if (revenueAliases.includes(matchKey)) {
      map.set('revenue', String(index));
    }
    if (transactionAliases.includes(matchKey)) {
      map.set('transactions', String(index));
    }
  });

  return map;
}

function parseDate(value: unknown) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    return date ? new Date(date.y, date.m - 1, date.d) : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }

    const [d, m, y] = trimmed.split(/[\/\-]/).map((part) => Number(part));
    if (d && m && y) {
      return new Date(y, m - 1, d);
    }
  }

  return null;
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/[, AED]/g, '').trim();
    if (!cleaned) {
      return 0;
    }
    const parsed = Number(cleaned);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function monthLabel(date: Date) {
  return date.toLocaleString('en-US', { month: 'short' });
}

function determineCurrentAndPrevious(rows: Array<{ date: Date; revenue: number; transactions: number; station: string }>) {
  const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());

  if (!sorted.length) {
    return { current: [], previous: [], currentLabel: 'Current period', previousLabel: 'Previous period' };
  }

  const years = [...new Set(sorted.map((row) => row.date.getFullYear()))].sort((a, b) => a - b);

  if (years.length >= 2) {
    const currentYear = years[years.length - 1];
    const previousYear = years[years.length - 2];

    return {
      current: sorted.filter((row) => row.date.getFullYear() === currentYear),
      previous: sorted.filter((row) => row.date.getFullYear() === previousYear),
      currentLabel: `${currentYear}`,
      previousLabel: `${previousYear}`,
    };
  }

  const splitIndex = Math.ceil(sorted.length / 2);
  return {
    current: sorted.slice(splitIndex),
    previous: sorted.slice(0, splitIndex),
    currentLabel: `${years[0]}`,
    previousLabel: 'Previous period',
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Please upload a spreadsheet file.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // Read EVERY sheet so workbooks with one sheet per year (e.g. "2023" and "2024"
    // tabs) are fully ingested before the year-split logic runs.
    const parsedRows: Array<{ station: string; date: Date; revenue: number; transactions: number }> = [];
    let headers: string[] = [];
    let headerMap = new Map<string, string>();

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
      if (!rawRows.length) continue;

      const sheetHeaders = rawRows[0].map((h) => String(h));
      const sheetHeaderMap = parseHeaderMap(sheetHeaders);

      // Skip sheets that don't have the required columns (e.g. summary/pivot tabs).
      if (!sheetHeaderMap.has('station') || !sheetHeaderMap.has('date') || !sheetHeaderMap.has('revenue')) {
        continue;
      }

      // Use the first valid sheet's headers for the response mapping field.
      if (!headers.length) {
        headers = sheetHeaders;
        headerMap = sheetHeaderMap;
      }

      for (const row of rawRows.slice(1)) {
        const station = String(row[Number(sheetHeaderMap.get('station'))] || '').trim();
        const date = parseDate(row[Number(sheetHeaderMap.get('date'))]);
        const revenue = parseNumber(row[Number(sheetHeaderMap.get('revenue'))]);
        const transactions = sheetHeaderMap.has('transactions')
          ? parseNumber(row[Number(sheetHeaderMap.get('transactions'))])
          : 0;
        if (!station || !date) continue;
        parsedRows.push({ station, date, revenue, transactions });
      }
    }

    if (!headers.length) {
      return NextResponse.json(
        {
          error:
            'The workbook must include columns for station, date, and revenue. Please map the file manually or use the expected headers.',
        },
        { status: 400 }
      );
    }

    if (!parsedRows.length) {
      return NextResponse.json({ error: 'No usable rows were found in the spreadsheet.' }, { status: 400 });
    }

    const period = determineCurrentAndPrevious(parsedRows);
    const currentRows = period.current;
    const previousRows = period.previous;

    const stationMap = new Map<string, { currentRevenue: number; currentTransactions: number; previousRevenue: number; previousTransactions: number }>();

    for (const row of currentRows) {
      const existing = stationMap.get(row.station) || {
        currentRevenue: 0,
        currentTransactions: 0,
        previousRevenue: 0,
        previousTransactions: 0,
      };
      existing.currentRevenue += row.revenue;
      existing.currentTransactions += row.transactions;
      stationMap.set(row.station, existing);
    }

    for (const row of previousRows) {
      const existing = stationMap.get(row.station) || {
        currentRevenue: 0,
        currentTransactions: 0,
        previousRevenue: 0,
        previousTransactions: 0,
      };
      existing.previousRevenue += row.revenue;
      existing.previousTransactions += row.transactions;
      stationMap.set(row.station, existing);
    }

    const stationInsights = Array.from(stationMap.entries()).map(([station, values]) => {
      const revenueChangePct = values.previousRevenue === 0 ? 100 : ((values.currentRevenue - values.previousRevenue) / values.previousRevenue) * 100;
      const transactionChangePct = values.previousTransactions === 0 ? 100 : ((values.currentTransactions - values.previousTransactions) / values.previousTransactions) * 100;

      let priority: StationInsight['priority'] = 'watch';
      if (revenueChangePct < -5 || transactionChangePct < -5) {
        priority = revenueChangePct < -10 || transactionChangePct < -10 ? 'high' : 'medium';
      }

      const reason =
        revenueChangePct < -5 && transactionChangePct < -5
          ? `${station} underperformed because revenue declined by ${Math.abs(revenueChangePct).toFixed(1)}% and transactions fell by ${Math.abs(transactionChangePct).toFixed(1)}%.`
          : revenueChangePct < -5
            ? `${station} underperformed because revenue declined by ${Math.abs(revenueChangePct).toFixed(1)}% despite stable transaction volume.`
            : transactionChangePct < -5
              ? `${station} underperformed because transaction volume dropped by ${Math.abs(transactionChangePct).toFixed(1)}% even though revenue remains present.`
              : `${station} is broadly aligned with the previous period and should be monitored for momentum.`;

      return {
        station,
        currentRevenue: values.currentRevenue,
        previousRevenue: values.previousRevenue,
        currentTransactions: values.currentTransactions,
        previousTransactions: values.previousTransactions,
        revenueChangePct,
        transactionChangePct,
        reason,
        priority,
      };
    }).sort((a, b) => a.priority.localeCompare(b.priority));

    // Pre-populate in calendar order so the X-axis always runs Jan → Dec,
    // regardless of which month the data starts or ends in.
    const MONTH_ORDER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyBuckets = new Map<string, { current: number; previous: number }>(
      MONTH_ORDER.map((m) => [m, { current: 0, previous: 0 }])
    );

    for (const row of currentRows) {
      const key = monthLabel(row.date);
      const bucket = monthlyBuckets.get(key);
      if (bucket) bucket.current += row.revenue;
    }

    for (const row of previousRows) {
      const key = monthLabel(row.date);
      const bucket = monthlyBuckets.get(key);
      if (bucket) bucket.previous += row.revenue;
    }

    // Emit months in Jan-Dec order; skip months with no data in either year.
    const revenueTrend = MONTH_ORDER
      .map((month) => ({
        month,
        current: monthlyBuckets.get(month)!.current,
        previous: monthlyBuckets.get(month)!.previous,
      }))
      .filter((entry) => entry.current > 0 || entry.previous > 0);

    const overallCurrentRevenue = currentRows.reduce((sum, row) => sum + row.revenue, 0);
    const overallCurrentTransactions = currentRows.reduce((sum, row) => sum + row.transactions, 0);

    return NextResponse.json({
      currentPeriodLabel: period.currentLabel,
      previousPeriodLabel: period.previousLabel,
      totalRevenue: overallCurrentRevenue,
      totalTransactions: overallCurrentTransactions,
      stationInsights,
      revenueTrend,
      mapping: {
        station: headers[Number(headerMap.get('station'))],
        date: headers[Number(headerMap.get('date'))],
        revenue: headers[Number(headerMap.get('revenue'))],
        transactions: headerMap.has('transactions') ? headers[Number(headerMap.get('transactions'))] : 'Not provided',
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to analyze the workbook. Please confirm the file format and column names.' },
      { status: 500 }
    );
  }
}

interface StationInsight { station: string; currentRevenue: number; previousRevenue: number; currentTransactions: number; previousTransactions: number; revenueChangePct: number; transactionChangePct: number; reason: string; priority: 'high' | 'medium' | 'watch'; }