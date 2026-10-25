import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { pipelineCards, pipelineLocationLanes, type PipelineCardQuery } from "@/lib/operational-pipeline";
import { DISPATCH_PERIODS, type DispatchPeriod } from "@/lib/pipeline-period";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

const STAGE = /^[a-z0-9_]{1,64}$/;
// Site codes are bound as parameters; this only bounds length and rejects control characters.
const SITE = /^[^\u0000-\u001f\u007f]{1,64}$/;
const MAX_OFFSET = 10_000;

/**
 * Read-only pipeline slices for the board:
 *   ?view=locations                       every location's first lane cards and exact lane totals
 *   ?stage=KEY&offset=N                   the next cards of one pipeline column
 *   ?site=CODE&period=P&offset=N          the next cards of one location lane
 *
 * Every read runs as the signed-in staff member under RLS, exactly as the
 * page does, so a slice can never show a client the board would not.
 */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;

  const sp = new URL(req.url).searchParams;
  if (sp.get("view") === "locations") {
    return ok({ locations: await pipelineLocationLanes(g.session) }, 200, traceId);
  }

  const offset = Number(sp.get("offset") ?? "0");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OFFSET) return err("invalid_input", "Invalid offset", 400, traceId);

  let query: PipelineCardQuery;
  const stage = sp.get("stage");
  const site = sp.get("site");
  const period = sp.get("period");
  if (stage !== null) {
    if (!STAGE.test(stage)) return err("invalid_input", "Invalid stage", 400, traceId);
    query = { kind: "stage", stage, offset };
  } else if (site !== null && period !== null) {
    if (!SITE.test(site)) return err("invalid_input", "Invalid site", 400, traceId);
    if (!(DISPATCH_PERIODS as readonly string[]).includes(period)) return err("invalid_input", "Invalid period", 400, traceId);
    query = { kind: "lane", site, period: period as DispatchPeriod, offset };
  } else {
    return err("invalid_input", "Specify view=locations, a stage, or a site and period", 400, traceId);
  }

  return ok(await pipelineCards(g.session, query), 200, traceId);
}
