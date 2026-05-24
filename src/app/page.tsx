'use client';

import { useMemo, useState } from 'react';
import { BarChart3, CalendarRange, Download, TrendingUp, AlertTriangle, Sparkles } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type SourceRow = {
  station: string;
  date: Date;
  revenue: number;
  transactions: number;
};

type StationInsight = {
  station: string;
  currentRevenue: number;
  previousRevenue: number;
  currentTransactions: number;
  previousTransactions: number;
  revenueChangePct: number;
  transactionChangePct: number;
  reason: string;
  priority: 'high' | 'medium' | 'watch';
};

type DashboardResult = {
  currentPeriodLabel: string;
  previousPeriodLabel: string;
  totalRevenue: number;
  totalTransactions: number;
  stationInsights: StationInsight[];
  revenueTrend: Array<{ month: string; current: number; previous: number }>;
  mapping: {
    station: string;
    date: string;
    revenue: string;
    transactions: string;
  };
};

const initialResult: DashboardResult = {
  currentPeriodLabel: 'Current period',
  previousPeriodLabel: 'Previous period',
  totalRevenue: 0,
  totalTransactions: 0,
  stationInsights: [],
  revenueTrend: [],
  mapping: {
    station: '',
    date: '',
    revenue: '',
    transactions: '',
  },
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPct(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function getReason(station: StationInsight) {
  if (station.priority === 'high') {
    return `${station.station} is underperforming due to a ${Math.abs(station.revenueChangePct).toFixed(1)}% revenue decline and ${Math.abs(station.transactionChangePct).toFixed(1)}% fewer transactions.`;
  }

  if (station.priority === 'medium') {
    return `${station.station} needs attention because revenue fell by ${Math.abs(station.revenueChangePct).toFixed(1)}% while transaction volume remained weak.`;
  }

  return `${station.station} is tracking broadly in line with the comparison period, but volume trends should be monitored.`;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DashboardResult>(initialResult);

  const lowPerformers = useMemo(
    () => result.stationInsights.filter((item) => item.priority !== 'watch'),
    [result.stationInsights]
  );

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] || null;

    setFile(selected);
    setError('');

    if (!selected) {
      setResult(initialResult);
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', selected);
      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Unable to analyze the spreadsheet.');
      }

      setResult(data as DashboardResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error while processing the spreadsheet.');
      setResult(initialResult);
    } finally {
      setLoading(false);
    }
  };

  const exportSummary = () => {
    const summary = [
      ['Station', 'Current Revenue', 'Previous Revenue', 'Revenue Change %', 'Current Transactions', 'Previous Transactions', 'Transaction Change %', 'Priority', 'Reason'],
      ...result.stationInsights.map((item) => [
        item.station,
        item.currentRevenue,
        item.previousRevenue,
        item.revenueChangePct,
        item.currentTransactions,
        item.previousTransactions,
        item.transactionChangePct,
        item.priority,
        item.reason,
      ]),
    ];

    const csv = summary
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'adnoc-station-performance.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen px-6 pb-14 pt-8 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <section className="overflow-hidden rounded-[28px] border border-white/70 bg-gradient-to-br from-adnoc-navy via-slate-900 to-adnoc-teal p-8 text-white shadow-glow">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-3xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm text-slate-100">
                <Sparkles className="h-4 w-4" />
                ADNOC Distribution MVP
              </div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Upload sales data and compare station performance across years.
              </h1>
              <p className="text-sm leading-7 text-slate-100/90 sm:text-base">
                This MVP analyzes your XLS file, compares the selected period against the previous year, highlights underperforming stations, and displays a Revenue Trends line chart for decision-making.
              </p>
            </div>

            <div className="grid gap-3 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm sm:min-w-[320px]">
              <div className="flex items-center gap-2 text-sm text-slate-100">
                <CalendarRange className="h-4 w-4 text-adnoc-mint" />
                Comparison logic
              </div>
              <div className="text-sm text-slate-100/90">
                <p>{result.currentPeriodLabel} vs {result.previousPeriodLabel}</p>
                <p className="mt-2">Underperformers are flagged when revenue or transactions decline materially.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr,1fr]">
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-adnoc-navy">Upload workbook</p>
                <p className="text-sm text-slate-600">Supported: XLS / XLSX</p>
              </div>
              <BarChart3 className="h-5 w-5 text-adnoc-teal" />
            </div>

            <label className="mt-5 flex cursor-pointer flex-col gap-3 rounded-2xl border border-dashed border-adnoc-teal/50 bg-adnoc-sand p-5">
              <span className="text-sm font-medium text-slate-800">Choose spreadsheet</span>
              <input type="file" accept=".xls,.xlsx" onChange={handleUpload} className="text-sm text-slate-600" />
              <span className="text-xs text-slate-500">
                The app will auto-detect common column names and guide you if the workbook uses a different header layout.
              </span>
            </label>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={exportSummary}
                disabled={!result.stationInsights.length}
                className="inline-flex items-center gap-2 rounded-full bg-adnoc-navy px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Download className="h-4 w-4" />
                Export summary
              </button>
              {loading && <span className="text-sm text-slate-600">Analyzing workbook...</span>}
            </div>

            {error ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Current revenue</p>
                <p className="mt-2 text-xl font-semibold text-adnoc-navy">{formatCurrency(result.totalRevenue)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Transactions</p>
                <p className="mt-2 text-xl font-semibold text-adnoc-navy">{result.totalTransactions.toLocaleString()}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Low performers</p>
                <p className="mt-2 text-xl font-semibold text-adnoc-navy">{lowPerformers.length}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 text-adnoc-navy">
              <AlertTriangle className="h-5 w-5 text-adnoc-amber" />
              <h2 className="text-lg font-semibold">Priority review</h2>
            </div>

            <div className="mt-4 space-y-3">
              {lowPerformers.length ? (
                lowPerformers.map((item) => (
                  <div key={item.station} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{item.station}</p>
                        <p className="text-sm text-slate-600">{item.reason}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {item.priority === 'high' ? 'High priority' : 'Needs review'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                  Upload a workbook to surface station-level insights and recommendations.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-adnoc-navy">Revenue Trends</p>
              <p className="text-sm text-slate-600">Monthly comparison between the current period and the previous period.</p>
            </div>
            <TrendingUp className="h-5 w-5 text-adnoc-teal" />
          </div>

          <div className="mt-5 h-[320px]">
            {result.revenueTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={result.revenueTrend}>
                  <CartesianGrid stroke="#dce4ec" strokeDasharray="4 4" />
                  <XAxis dataKey="month" stroke="#0B1F3A" />
                  <YAxis stroke="#0B1F3A" tickFormatter={(value) => `AED ${value / 1000}k`} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      formatCurrency(value),
                      name === 'current' ? result.currentPeriodLabel : result.previousPeriodLabel,
                    ]}
                    contentStyle={{ borderRadius: 16, borderColor: '#dce4ec' }}
                  />
                  <Legend
                    formatter={(value) =>
                      value === 'current' ? result.currentPeriodLabel : result.previousPeriodLabel
                    }
                  />
                  <Line type="monotone" dataKey="current" name="current" stroke="#1D9BC8" strokeWidth={3} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="previous" name="previous" stroke="#F4C95D" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
                No chart data available until a workbook is uploaded.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-adnoc-navy">Station breakdown</p>
              <p className="text-sm text-slate-600">A concise performance snapshot for every station in the uploaded file.</p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead>
                <tr className="text-slate-600">
                  <th className="px-3 py-2 font-semibold">Station</th>
                  <th className="px-3 py-2 font-semibold">Current revenue</th>
                  <th className="px-3 py-2 font-semibold">Previous revenue</th>
                  <th className="px-3 py-2 font-semibold">Revenue change</th>
                  <th className="px-3 py-2 font-semibold">Transactions change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.stationInsights.length ? (
                  result.stationInsights.map((item) => (
                    <tr key={item.station} className="odd:bg-white even:bg-slate-50/60">
                      <td className="px-3 py-3 font-medium text-slate-900">{item.station}</td>
                      <td className="px-3 py-3">{formatCurrency(item.currentRevenue)}</td>
                      <td className="px-3 py-3">{formatCurrency(item.previousRevenue)}</td>
                      <td className={`px-3 py-3 font-semibold ${item.revenueChangePct < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatPct(item.revenueChangePct)}</td>
                      <td className={`px-3 py-3 font-semibold ${item.transactionChangePct < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatPct(item.transactionChangePct)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">
                      Upload your workbook to view the comparisons.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}