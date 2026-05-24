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
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

    if (!rows.length) {
      return NextResponse.json({ error: 'The spreadsheet is empty.' }, { status: 400 });
    }

    const headers = rows[0].map((header) => String(header));
    const headerMap = parseHeaderMap(headers);

    if (!headerMap.has('station') || !headerMap.has('date') || !headerMap.has('revenue')) {
      return NextResponse.json(
        {
          error:
            'The workbook must include columns for station, date, and revenue. Please map the file manually or use the expected headers.',
        },
        { status: 400 }
      );
    }

    const parsedRows = rows.slice(1).reduce<Array<{ station: string; date: Date; revenue: number; transactions: number }>>((acc, row) => {
      const station = String(row[Number(headerMap.get('station'))] || '').trim();
      const date = parseDate(row[Number(headerMap.get('date'))]);
      const revenue = parseNumber(row[Number(headerMap.get('revenue'))]);
      const transactions = headerMap.has('transactions') ? parseNumber(row[Number(headerMap.get('transactions'))]) : 0;

      if (!station || !date) {
        return acc;
      }

      acc.push({
        station,
        date,
        revenue,
        transactions,
      });

      return acc;
    }, []);

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

    const monthlyBuckets = new Map<string, { current: number; previous: number }>();

    for (const row of currentRows) {
      const key = monthLabel(row.date);
      const bucket = monthlyBuckets.get(key) || { current: 0, previous: 0 };
      bucket.current += row.revenue;
      monthlyBuckets.set(key, bucket);
    }

    for (const row of previousRows) {
      const key = monthLabel(row.date);
      const bucket = monthlyBuckets.get(key) || { current: 0, previous: 0 };
      bucket.previous += row.revenue;
      monthlyBuckets.set(key, bucket);
    }

    const revenueTrend = Array.from(monthlyBuckets.entries()).map(([month, values]) => ({
      month,
      current: values.current,
      previous: values.previous,
    }));

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