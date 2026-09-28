import "server-only";
import { ActionError } from "@/lib/service";

const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const MAX_ROWS = 1001;
const MAX_CELLS = 50_000;

type SheetMeta = {
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
};

type ValuesResponse = { values?: unknown[][] };

function parseSheetUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ActionError("invalid_sheet_url", "Invalid Google Sheets URL", 400);
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
    throw new ActionError("invalid_sheet_url", "Only https://docs.google.com Google Sheets URLs are accepted", 400);
  }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!match) throw new ActionError("invalid_sheet_url", "Google Sheets document ID is missing", 400);
  const gidRaw = url.searchParams.get("gid") ?? url.hash.match(/gid=(\d+)/)?.[1] ?? "0";
  if (!/^\d+$/.test(gidRaw)) throw new ActionError("invalid_sheet_url", "Google Sheets gid is invalid", 400);
  return { spreadsheetId: match[1], gid: Number(gidRaw) };
}

function apiKey() {
  const key = process.env.GOOGLE_SHEETS_API_KEY?.trim();
  if (!key) throw new ActionError("google_sheets_not_configured", "Google Sheets API is NOT_CONFIGURED", 503);
  return key;
}

async function googleJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  }).catch(() => null);
  if (!response) throw new ActionError("sheet_unavailable", "Google Sheets API request failed", 502);
  if (response.status === 403) throw new ActionError("sheet_forbidden", "Google Sheets API denied access to this spreadsheet", 403);
  if (response.status === 404) throw new ActionError("sheet_not_found", "Google spreadsheet was not found", 404);
  if (!response.ok) throw new ActionError("sheet_unavailable", `Google Sheets API returned ${response.status}`, 502);
  return await response.json() as T;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function fetchGoogleSheetCsv(input: string) {
  const { spreadsheetId, gid } = parseSheetUrl(input);
  const key = apiKey();

  const metaUrl = new URL(`${API_BASE}/${encodeURIComponent(spreadsheetId)}`);
  metaUrl.searchParams.set("fields", "sheets.properties(sheetId,title)");
  metaUrl.searchParams.set("key", key);
  const meta = await googleJson<SheetMeta>(metaUrl);
  const sheet = meta.sheets?.find((item) => item.properties?.sheetId === gid)
    ?? (gid === 0 ? meta.sheets?.[0] : undefined);
  const title = sheet?.properties?.title;
  if (!title) throw new ActionError("sheet_tab_not_found", `Google Sheets tab gid=${gid} was not found`, 422);

  const range = `'${title.replaceAll("'", "''")}'`;
  const valuesUrl = new URL(`${API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
  valuesUrl.searchParams.set("majorDimension", "ROWS");
  valuesUrl.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  valuesUrl.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
  valuesUrl.searchParams.set("key", key);
  const data = await googleJson<ValuesResponse>(valuesUrl);
  const rows = Array.isArray(data.values) ? data.values : [];
  if (rows.length === 0) throw new ActionError("empty_import", "The Google Sheet contains no rows", 400);
  if (rows.length > MAX_ROWS) throw new ActionError("too_many_rows", `Google Sheets import is limited to ${MAX_ROWS - 1} data rows`, 400);

  let cells = 0;
  for (const row of rows) {
    if (!Array.isArray(row)) throw new ActionError("invalid_sheet", "Google Sheets API returned an invalid row", 422);
    cells += row.length;
    if (cells > MAX_CELLS) throw new ActionError("sheet_too_large", "Google Sheet exceeds the supported cell limit", 413);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
