import { authorizeRequest } from "@/lib/api/policy";
import { NextResponse } from "next/server";

import { createApiError } from "@/lib/server/api-validation";
import { reconcileVsIndex } from "@/lib/server/vs-index";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Worker-tier authorization, delegated to lib/api/policy.ts.
 *
 * Was a local Bearer-token string comparison duplicated in two routes. Two
 * copies of an auth check is two places for one of them to drift, and a plain
 * string compare on a secret leaks its length through timing. The tier also
 * applies the route rate limit, which this route previously had none of.
 */
function authorizeWorker(request: Request, route: string) {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  return authorizeRequest("internal_worker", {
    route,
    presentedSecret: presented,
    expectedSecret: process.env.CRON_SECRET,
  });
}

export async function GET(request: Request) {
  try {
    const auth = authorizeWorker(request, "/api/cron/sync");
    if (!auth.allowed && auth.error) {
      // The tier's error already carries a machine-readable code, a retryable flag
      // and a Retry-After when waiting can help.
      return NextResponse.json(auth.error.body, {
        status: auth.error.status,
        headers: auth.error.headers,
      });
    }

    const summary = await reconcileVsIndex();

    return NextResponse.json(
      {
        synced: summary.synced,
        new: summary.new,
        stateChanges: summary.stateChanges,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch {
    return NextResponse.json(
      createApiError("internal_error", "Unable to reconcile VS index"),
      { status: 500 }
    );
  }
}
