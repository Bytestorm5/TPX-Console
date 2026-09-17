/**
 * Product-local presentation helpers: provider icons, the vocabulary for the
 * four resolution levels, and the field renderers every page shares.
 * Nothing here ever sees a secret value — only hints and set/unset state.
 */
import {
  Check,
  Cloud,
  Copy,
  Database,
  GitBranch,
  Kanban,
  Mail,
  Plug,
  ShieldAlert,
  Sparkles,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Form } from "react-router";
import type { FieldSpec, Hints, ResolutionLevel, RevealedSecret, Values } from "@tpx/contracts/connections";
import { Badge, Button, Field, Input, type BadgeTone } from "@tpx/ui";
import { formatWhen, maskHint } from "~/lib/format.ts";

const ICONS: Record<string, LucideIcon> = {
  cloud: Cloud,
  github: GitBranch,
  database: Database,
  kanban: Kanban,
  mail: Mail,
  sparkles: Sparkles,
  webhook: Webhook,
};

/** The marketplace tile / row icon for a provider's declared icon name. */
export function ProviderIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Icon: LucideIcon = ICONS[name] ?? Plug;
  return <Icon size={size} className={className} />;
}

export const LEVEL_LABELS: Record<ResolutionLevel, string> = {
  binding: "environment override",
  attachment: "project override",
  "connection-environment": "connection default",
  "connection-base": "connection base",
};

/** Overridden (project or environment) vs inherited (from the connection), as the doc calls for. */
export function LevelBadge({ level }: { level: ResolutionLevel | null }) {
  if (level === null) return <Badge tone="danger">unset</Badge>;
  const overridden = level === "binding" || level === "attachment";
  const tone: BadgeTone = overridden ? "accent" : "neutral";
  return (
    <Badge tone={tone} title={LEVEL_LABELS[level]}>
      {overridden ? "overridden" : "inherited"} · {LEVEL_LABELS[level]}
    </Badge>
  );
}

export function TestBadge({ lastTest }: { lastTest: { ok: boolean; at: number; message: string } | null }) {
  if (!lastTest) return <Badge tone="neutral">never tested</Badge>;
  return (
    <Badge tone={lastTest.ok ? "success" : "danger"} title={`${lastTest.message} · ${formatWhen(lastTest.at)}`}>
      {lastTest.ok ? "test passed" : "test failed"}
    </Badge>
  );
}

/** Config inputs prefilled with the current values at one level. Blank submits as "" (which unsets). */
export function ConfigInputs({
  fields,
  values,
  prefix = "config",
  idScope = prefix,
}: {
  fields: readonly FieldSpec[];
  values: Values;
  prefix?: string;
  idScope?: string;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((spec) => (
        <Field key={spec.key} label={spec.label} htmlFor={`${idScope}-${spec.key}`} help={spec.help}>
          <Input
            id={`${idScope}-${spec.key}`}
            name={`${prefix}:${spec.key}`}
            defaultValue={values[spec.key] ?? ""}
            placeholder={spec.placeholder}
            required={spec.required && prefix === "config-create"}
            autoComplete="off"
          />
        </Field>
      ))}
    </div>
  );
}

/**
 * Secret inputs. Values are write-only: the input is always empty, the
 * placeholder says whether something is stored, and a blank field means
 * "leave as is". Clearing is a separate, explicit action.
 */
export function CredentialInputs({
  fields,
  hints,
  prefix = "credential",
  idScope = prefix,
  creating = false,
  override = false,
}: {
  fields: readonly FieldSpec[];
  hints: Hints;
  prefix?: string;
  /** Distinguishes ids when two forms on a page render the same fields. */
  idScope?: string;
  creating?: boolean;
  override?: boolean;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((spec) => {
        const hint = hints[spec.key];
        const stored = hint?.set
          ? `stored ${maskHint(hint.hint)} · blank keeps it`
          : creating
            ? (spec.placeholder ?? "")
            : override
              ? "inherits · blank keeps it"
              : "not set";
        return (
          <Field key={spec.key} label={spec.label} htmlFor={`${idScope}-${spec.key}`} help={spec.help}>
            <Input
              id={`${idScope}-${spec.key}`}
              name={`${prefix}:${spec.key}`}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder={stored}
              required={creating && spec.required}
              className="font-mono"
            />
          </Field>
        );
      })}
    </div>
  );
}

/** The stored-secret rows at one level: set or not, hint, when, and the explicit reveal/clear actions. */
export function SecretRows({
  fields,
  hints,
  canReveal,
  canClear,
  hidden,
  override = false,
}: {
  fields: readonly FieldSpec[];
  hints: Hints;
  canReveal: boolean;
  canClear: boolean;
  /** Hidden inputs identifying the level, echoed by the reveal and clear forms. */
  hidden: Record<string, string>;
  /** An override level: an unset secret simply inherits, it is never "required" here. */
  override?: boolean;
}) {
  const secrets = fields.filter((f) => f.secret);
  if (secrets.length === 0) return null;
  return (
    <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
      {secrets.map((spec) => {
        const hint = hints[spec.key];
        return (
          <li key={spec.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-ink">{spec.label}</span>
              <span className="ml-2 font-mono text-xs text-ink-muted">
                {hint?.set ? maskHint(hint.hint) : "not set"}
              </span>
              {hint?.set && hint.updatedAt ? (
                <span className="ml-2 text-xs text-ink-muted">updated {formatWhen(hint.updatedAt)}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {hint?.set ? (
                <Badge tone="success">set</Badge>
              ) : override ? (
                <Badge tone="neutral">inherits</Badge>
              ) : (
                <Badge tone={spec.required ? "warning" : "neutral"}>{spec.required ? "required" : "optional"}</Badge>
              )}
              {hint?.set && canReveal ? (
                <Form method="post">
                  {Object.entries(hidden).map(([k, v]) => (
                    <input key={k} type="hidden" name={k} value={v} />
                  ))}
                  <input type="hidden" name="intent" value="reveal" />
                  <input type="hidden" name="key" value={spec.key} />
                  <button
                    type="submit"
                    className="rounded-sm bg-surface-raised px-2 py-1 text-xs font-semibold text-ink hover:bg-border-subtle"
                  >
                    Reveal
                  </button>
                </Form>
              ) : null}
              {hint?.set && canClear ? (
                <Form method="post">
                  {Object.entries(hidden).map(([k, v]) => (
                    <input key={k} type="hidden" name={k} value={v} />
                  ))}
                  <input type="hidden" name="intent" value="clear" />
                  <input type="hidden" name="key" value={spec.key} />
                  <button
                    type="submit"
                    className="rounded-sm bg-surface-raised px-2 py-1 text-xs font-semibold text-danger hover:bg-border-subtle"
                  >
                    Clear
                  </button>
                </Form>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A revealed secret, shown once in the action result. It is never written to
 * the loader data, never cached (the action response is `no-store`), and the
 * reveal itself is already in the audit log by the time this renders.
 */
export function RevealedSecretPanel({ revealed }: { revealed: RevealedSecret }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-4" data-testid="revealed-secret">
      <div className="flex items-start gap-3">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {revealed.key} · {LEVEL_LABELS[revealed.suppliedBy]}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            This reveal was recorded in the audit log with your user id. The value disappears when you leave the page.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-sm bg-surface px-3 py-2 font-mono text-sm text-ink">
              {revealed.value}
            </code>
            <Button
              variant="secondary"
              size="sm"
              icon={copied ? <Check size={14} /> : <Copy size={14} />}
              onClick={() => {
                void navigator.clipboard.writeText(revealed.value).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ActionNotice({ result }: { result: { ok: boolean; error?: string; message?: string } | undefined }) {
  if (!result) return null;
  if (!result.ok) return <p className="text-sm text-danger">{result.error ?? "Something went wrong."}</p>;
  return result.message ? <p className="text-sm text-success">{result.message}</p> : null;
}
