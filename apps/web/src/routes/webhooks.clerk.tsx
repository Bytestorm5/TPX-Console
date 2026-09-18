import { verifyWebhook } from "@clerk/react-router/webhooks";
import type { Route } from "./+types/webhooks.clerk";
import { cloudflareContext } from "../shell/context.ts";

/**
 * Clerk → console. Clerk only authenticates, so the one event that matters is
 * a deleted user: their memberships, grants and profile go with them.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { env, services } = context.get(cloudflareContext);
  if (!env.CLERK_WEBHOOK_SIGNING_SECRET) return new Response("webhook signing secret not configured", { status: 503 });
  let event;
  try {
    event = await verifyWebhook(request, { signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET });
  } catch (error) {
    console.warn("clerk webhook rejected", error);
    return new Response("invalid signature", { status: 400 });
  }
  if (event.type === "user.deleted") {
    const data = event.data as { id?: string; deleted?: boolean };
    if (data.id) await services.auth.forgetUser(data.id);
  }
  return Response.json({ ok: true });
}

export function loader() {
  return new Response("method not allowed", { status: 405 });
}
