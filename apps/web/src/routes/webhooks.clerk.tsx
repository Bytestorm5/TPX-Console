import { verifyWebhook } from "@clerk/react-router/webhooks";
import type { Route } from "./+types/webhooks.clerk";
import { cloudflareContext } from "../shell/context.ts";

/**
 * Clerk → console. Membership removals sweep the user's tenant grants so a
 * removed member loses access even before their session lapses.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  if (!env.CLERK_WEBHOOK_SIGNING_SECRET) return new Response("webhook signing secret not configured", { status: 503 });
  let event;
  try {
    event = await verifyWebhook(request, { signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET });
  } catch (error) {
    console.warn("clerk webhook rejected", error);
    return new Response("invalid signature", { status: 400 });
  }
  switch (event.type) {
    case "organizationMembership.deleted": {
      const data = event.data as { organization: { id: string }; public_user_data: { user_id: string } };
      await env.AUTH.removeMember({ orgId: data.organization.id, userId: data.public_user_data.user_id });
      break;
    }
    default:
      break;
  }
  return Response.json({ ok: true });
}

export function loader() {
  return new Response("method not allowed", { status: 405 });
}
