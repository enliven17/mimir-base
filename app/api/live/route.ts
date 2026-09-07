// Platform liveness must not restart healthy web processes when an independent
// worker or LLM provider is unavailable. /api/health remains the ops probe.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
