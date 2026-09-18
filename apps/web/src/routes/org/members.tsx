import { Mail, UserMinus, UserPlus, X } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { InviteMemberInputSchema } from "@tpx/contracts/auth";
import { hasGrant } from "@tpx/identity";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@tpx/ui";
import type { Route } from "./+types/members";
import { cloudflareContext } from "../../shell/context.ts";
import { attempt, rpc } from "../../shell/rpc.server.ts";
import { assertGrant, requireTenant } from "../../shell/session.server.ts";
import { formValues } from "../../lib/forms.ts";
import { formatWhen } from "../../lib/format.ts";

export const meta: Route.MetaFunction = () => [{ title: "Members · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = requireTenant(args);
  assertGrant(session.tenantCtx, "tpx.workspace.members.read");
  const [members, invites, roles] = await Promise.all([
    rpc(env.AUTH.listMembers(session.tenantCtx)),
    rpc(env.AUTH.listInvites(session.tenantCtx)),
    rpc(env.AUTH.listRoles()),
  ]);
  return {
    members,
    invites,
    roles,
    tenant: session.tenant,
    me: session.identity.userId,
    canManage: hasGrant(session.tenantCtx, "tpx.workspace.members.manage_members"),
  };
}

export async function action(args: Route.ActionArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = requireTenant(args);
  assertGrant(session.tenantCtx, "tpx.workspace.members.manage_members");
  const values = formValues(await args.request.formData());
  switch (values.intent) {
    case "invite": {
      const parsed = InviteMemberInputSchema.safeParse({ email: values.email, roleId: values.roleId });
      if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
      const result = await attempt(env.AUTH.inviteMember(session.tenantCtx, parsed.data));
      if (!result.ok) return result;
      return {
        ok: true as const,
        message:
          result.value.kind === "added"
            ? `${result.value.member.email ?? result.value.member.userId} is now a member.`
            : `Invitation sent to ${result.value.invite.email}; it is claimed on their first sign-in.`,
      };
    }
    case "revoke": {
      const result = await attempt(env.AUTH.revokeInvite(session.tenantCtx, values.inviteId ?? ""));
      return result.ok ? { ok: true as const, message: "Invitation revoked." } : result;
    }
    case "remove": {
      const result = await attempt(env.AUTH.removeMember(session.tenantCtx, values.userId ?? ""));
      return result.ok ? { ok: true as const, message: "Member removed." } : result;
    }
    default:
      return { ok: false as const, error: "Unknown action." };
  }
}

const ROLE_TONES: Record<string, "accent" | "success" | "neutral" | "warning"> = {
  "tpx-owner": "warning",
  "tpx-admin": "accent",
  "tpx-member": "success",
  "tpx-viewer": "neutral",
};

export default function Members({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { members, invites, roles, tenant, me, canManage } = loaderData;
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  return (
    <>
      <PageHeader
        eyebrow={tenant.name}
        title="Members"
        description="Who belongs to this organization. Membership and invitations are the console's own; sign-in is the only thing the identity provider does. Finer-grained grants live under Access."
      />
      {actionData ? (
        <p
          className={actionData.ok ? "mb-4 text-sm text-success" : "mb-4 text-sm text-danger"}
          data-testid="members-notice"
        >
          {actionData.ok ? actionData.message : actionData.error}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Members" description={`${members.length} in ${tenant.name}`} />
            <Table>
              <THead>
                <tr>
                  <TH>Member</TH>
                  <TH>Roles at the tenant</TH>
                  <TH>Joined</TH>
                  {canManage ? <TH className="text-right">Actions</TH> : null}
                </tr>
              </THead>
              <TBody>
                {members.map((m) => (
                  <TR key={m.userId} data-testid={`member-${m.userId}`}>
                    <TD>
                      <p className="font-medium">
                        {m.displayName ?? m.userId}
                        {m.userId === me ? <span className="ml-2 text-xs text-ink-muted">you</span> : null}
                      </p>
                      {m.email ? <p className="text-xs text-ink-muted">{m.email}</p> : null}
                    </TD>
                    <TD>
                      <span className="flex flex-wrap gap-1">
                        {m.roles.length === 0 ? <Badge>member (org)</Badge> : null}
                        {m.roles.map((r) => (
                          <Badge key={r} tone={ROLE_TONES[r] ?? "neutral"}>
                            {roleName(r)}
                          </Badge>
                        ))}
                      </span>
                    </TD>
                    <TD className="text-xs text-ink-muted">{formatWhen(m.joinedAt)}</TD>
                    {canManage ? (
                      <TD className="text-right">
                        {m.userId === me ? null : (
                          <Form
                            method="post"
                            onSubmit={(e) =>
                              window.confirm(`Remove ${m.displayName ?? m.userId}?`) ? undefined : e.preventDefault()
                            }
                          >
                            <input type="hidden" name="intent" value="remove" />
                            <input type="hidden" name="userId" value={m.userId} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              icon={<UserMinus size={14} />}
                              className="text-danger"
                            >
                              Remove
                            </Button>
                          </Form>
                        )}
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader
              title="Pending invitations"
              description="Claimed automatically when the invitee signs in with that email."
            />
            {invites.length === 0 ? (
              <EmptyState icon={<Mail size={24} />} title="No pending invitations" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Email</TH>
                    <TH>Role</TH>
                    <TH>Invited</TH>
                    {canManage ? <TH className="text-right">Actions</TH> : null}
                  </tr>
                </THead>
                <TBody>
                  {invites.map((i) => (
                    <TR key={i.id} data-testid={`invite-${i.email}`}>
                      <TD className="font-medium">{i.email}</TD>
                      <TD>
                        <Badge tone={ROLE_TONES[i.roleId] ?? "neutral"}>{roleName(i.roleId)}</Badge>
                      </TD>
                      <TD className="text-xs text-ink-muted">{formatWhen(i.createdAt)}</TD>
                      {canManage ? (
                        <TD className="text-right">
                          <Form method="post">
                            <input type="hidden" name="intent" value="revoke" />
                            <input type="hidden" name="inviteId" value={i.id} />
                            <Button type="submit" variant="ghost" size="sm" disabled={busy} icon={<X size={14} />}>
                              Revoke
                            </Button>
                          </Form>
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
        <Card>
          <CardHeader
            title="Invite a member"
            description="By email. A known user joins at once; anyone else joins on their first sign-in."
          />
          {canManage ? (
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="invite" />
              <Field label="Email" htmlFor="email">
                <Input id="email" name="email" type="email" required placeholder="colleague@example.com" />
              </Field>
              <Field label="Role" htmlFor="roleId" help="Granted at the whole tenant; narrow it later under Access.">
                <Select id="roleId" name="roleId" defaultValue="tpx-member">
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} — {r.description}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" disabled={busy} icon={<UserPlus size={16} />}>
                Invite
              </Button>
            </Form>
          ) : (
            <p className="text-sm text-ink-muted">You can view members but not invite or remove them.</p>
          )}
        </Card>
      </div>
    </>
  );
}
