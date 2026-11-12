"use client";

import { AllCommunityModule, themeQuartz, type CellValueChangedEvent, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { approveClaims, rejectClaims, syncPaymentsAction, updateClaimFieldAction } from "@/app/actions/claims";
import { RiskBadge, StatusBadge } from "@/components/badges";
import { formatDate, formatMoney } from "@/lib/format";
import type { ClaimListRow } from "@/lib/queries";
import { ACTIVE_STATUSES, type ClaimStatus } from "@/lib/types";

const MODULES = [AllCommunityModule];

const theme = themeQuartz.withParams({
  accentColor: "#2563eb",
  browserColorScheme: "light",
  fontFamily: "inherit",
  fontSize: 13,
  headerBackgroundColor: "#f8fafc",
  headerTextColor: "#475569",
  wrapperBorderRadius: 0,
  wrapperBorder: false,
  spacing: 7,
});

const TABS: { key: string; label: string; match: (status: ClaimStatus) => boolean }[] = [
  { key: "review", label: "Needs review", match: (s) => s === "IN_REVIEW" },
  { key: "active", label: "In progress", match: (s) => ACTIVE_STATUSES.includes(s) },
  { key: "paid", label: "Paid", match: (s) => s === "PAID" },
  { key: "problems", label: "Rejected / failed", match: (s) => s === "REJECTED" || s === "PAYMENT_FAILED" },
  { key: "all", label: "All claims", match: () => true },
];

type Message = { tone: "ok" | "error"; text: string } | null;

interface Props {
  rows: ClaimListRow[];
  categories: Record<string, string>;
  currency: string;
  adminApprovalAbove: number;
  isAdmin: boolean;
}

const isInReview = (row: ClaimListRow | undefined) => row?.status === "IN_REVIEW";

export function ReviewGrid({ rows, categories, currency, adminApprovalAbove, isAdmin }: Props) {
  const gridRef = useRef<AgGridReact<ClaimListRow>>(null);
  const [tab, setTab] = useState(() => (rows.some((r) => r.status === "IN_REVIEW") ? "review" : "all"));
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<ClaimListRow[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  const visibleRows = useMemo(() => {
    const active = TABS.find((t) => t.key === tab) ?? TABS[TABS.length - 1];
    return rows.filter((r) => active.match(r.status));
  }, [rows, tab]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, rows.filter((r) => t.match(r.status)).length])), [rows]);

  const columnDefs = useMemo<ColDef<ClaimListRow>[]>(
    () => [
      {
        field: "riskScore",
        headerName: "Risk",
        width: 80,
        cellRenderer: (p: ICellRendererParams<ClaimListRow>) => (
          <RiskBadge score={p.data?.riskScore ?? null} level={p.data?.riskLevel ?? null} compact />
        ),
      },
      {
        field: "status",
        headerName: "Status",
        width: 135,
        cellRenderer: (p: ICellRendererParams<ClaimListRow>) => (p.data ? <StatusBadge status={p.data.status} /> : null),
      },
      { field: "startup", headerName: "Startup", width: 130 },
      {
        field: "vendor",
        headerName: "Vendor",
        flex: 1,
        minWidth: 160,
        editable: (p) => isInReview(p.data),
        cellRenderer: (p: ICellRendererParams<ClaimListRow>) => (
          <span className="flex items-center gap-1.5">
            {p.data?.humanVerified && <span title="Corrected by a reviewer" className="h-2 w-2 shrink-0 rounded-full bg-violet-500" />}
            {p.value ?? <span className="text-slate-400">—</span>}
          </span>
        ),
      },
      {
        field: "receiptDate",
        headerName: "Receipt date",
        width: 130,
        cellDataType: "dateString",
        editable: (p) => isInReview(p.data),
        valueFormatter: (p) => formatDate(p.value),
      },
      {
        field: "amount",
        headerName: "Amount",
        width: 120,
        type: "rightAligned",
        cellDataType: "number",
        editable: (p) => isInReview(p.data),
        cellEditor: "agNumberCellEditor",
        cellEditorParams: { min: 0.01, precision: 2 },
        valueFormatter: (p) => formatMoney(p.value, p.data?.currency ?? currency),
      },
      {
        field: "currency",
        headerName: "Cur.",
        width: 75,
        editable: (p) => isInReview(p.data),
      },
      {
        field: "category",
        headerName: "Category",
        width: 145,
        editable: (p) => isInReview(p.data),
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: Object.keys(categories) },
        refData: categories,
      },
      {
        field: "flags",
        headerName: "Agent findings",
        flex: 1.6,
        minWidth: 240,
        sortable: false,
        valueFormatter: (p) => (p.value?.length ? p.value[0] : ""),
        tooltipValueGetter: (p) => (p.data?.flags.length ? p.data.flags.join("\n") : null),
        cellRenderer: (p: ICellRendererParams<ClaimListRow>) => {
          const flags = p.data?.flags ?? [];
          if (!flags.length) return <span className="text-slate-400">No findings</span>;
          return (
            <span className="flex items-center gap-2">
              <span className="rounded bg-amber-100 px-1.5 text-xs font-bold text-amber-900">{flags.length}</span>
              <span className="truncate">{flags[0]}</span>
            </span>
          );
        },
      },
      {
        colId: "open",
        headerName: "",
        width: 75,
        pinned: "right",
        sortable: false,
        filter: false,
        cellRenderer: (p: ICellRendererParams<ClaimListRow>) =>
          p.data ? (
            <Link href={`/claims/${p.data.id}`} className="font-semibold text-blue-600 hover:underline">
              Open
            </Link>
          ) : null,
      },
    ],
    [categories, currency],
  );

  const defaultColDef = useMemo<ColDef<ClaimListRow>>(() => ({ sortable: true, resizable: true, filter: true }), []);
  const rowSelection = useMemo(
    () => ({ mode: "multiRow" as const, isRowSelectable: (node: { data?: ClaimListRow }) => isInReview(node.data), hideDisabledCheckboxes: true }),
    [],
  );

  const onCellValueChanged = (event: CellValueChangedEvent<ClaimListRow>) => {
    const field = event.colDef.field;
    if (!event.data || !field || event.source === "revert" || event.newValue === event.oldValue) return;
    startTransition(async () => {
      const result = await updateClaimFieldAction(event.data.id, toColumn(field), event.newValue);
      if (result.error) {
        event.node.setDataValue(field, event.oldValue, "revert");
        setMessage({ tone: "error", text: result.error });
      } else {
        setMessage({ tone: "ok", text: "Saved. The agents re-checked the claim with your correction." });
      }
    });
  };

  const runDecision = (decision: "approve" | "reject") => {
    const ids = selected.map((r) => r.id);
    startTransition(async () => {
      const result = decision === "approve" ? await approveClaims(ids, note) : await rejectClaims(ids, note);
      if (result.error) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      const skipped = result.skipped ?? [];
      setMessage({
        tone: skipped.length ? "error" : "ok",
        text: `${decision === "approve" ? "Approved" : "Rejected"} ${result.updated ?? 0} claim(s).${
          skipped.length ? ` Skipped ${skipped.length}: ${skipped[0].reason}.` : decision === "approve" ? " Payouts started." : ""
        }`,
      });
      setNote("");
      gridRef.current?.api.deselectAll();
    });
  };

  const needsAdmin = !isAdmin && selected.some((r) => (r.amount ?? 0) > adminApprovalAbove);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {t.label} <span className={tab === t.key ? "text-blue-100" : "text-slate-400"}>{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search claims…"
            className="w-52 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await syncPaymentsAction();
                setMessage({ tone: "ok", text: result.message });
              })
            }
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Sync PayPal
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <span className="text-sm text-slate-600">
          <strong className="text-slate-900">{selected.length}</strong> selected
        </span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Note / rejection reason"
          className="min-w-64 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <button
          type="button"
          disabled={pending || selected.length === 0}
          onClick={() => runDecision("approve")}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Approve & pay
        </button>
        <button
          type="button"
          disabled={pending || selected.length === 0}
          onClick={() => runDecision("reject")}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
        >
          Reject
        </button>
        {needsAdmin && <span className="text-xs text-amber-700">Claims above {formatMoney(adminApprovalAbove, currency)} need an admin.</span>}
      </div>

      {message && (
        <p role="status" className={`px-4 py-2 text-sm ${message.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
          {message.text}
        </p>
      )}

      <AgGridProvider modules={MODULES}>
        <AgGridReact<ClaimListRow>
          ref={gridRef}
          theme={theme}
          domLayout="autoHeight"
          rowData={visibleRows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(p) => p.data.id}
          rowSelection={rowSelection}
          onSelectionChanged={(e) => setSelected(e.api.getSelectedRows())}
          onCellValueChanged={onCellValueChanged}
          quickFilterText={search}
          rowHeight={44}
          tooltipShowDelay={300}
          pagination
          paginationPageSize={20}
          paginationPageSizeSelector={[20, 50, 100]}
          overlayNoRowsTemplate="No claims in this view."
          stopEditingWhenCellsLoseFocus
        />
      </AgGridProvider>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        Double-click Vendor, Receipt date, Amount, Currency or Category on a claim in review to correct what the AI read. Every edit is audited and
        re-checked by the agents.
      </p>
    </div>
  );
}

function toColumn(field: string): string {
  return field === "receiptDate" ? "receipt_date" : field;
}
