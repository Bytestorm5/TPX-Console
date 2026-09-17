import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router";
import type { Environment, Project } from "@tpx/contracts/auth";
import { Select } from "@tpx/ui";

/**
 * Project and environment pickers. The environment picker hides itself until
 * the project has two environments, so a solo operator never sees the level.
 */
export function ScopeSwitcher({
  projects,
  project,
  environments,
  environment,
}: {
  projects: Project[];
  project: Project | null;
  environments: Environment[];
  environment: Environment | null;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-1">
      <Select
        aria-label="Project"
        className="h-9 min-w-0 flex-1 text-sm"
        value={project?.slug ?? ""}
        onChange={(e) => void navigate(`/${e.target.value}`)}
      >
        {project === null ? <option value="">Choose a project</option> : null}
        {projects.map((p) => (
          <option key={p.id} value={p.slug}>
            {p.name}
          </option>
        ))}
      </Select>
      {project && environments.length > 1 && environment ? (
        <>
          <ChevronRight size={14} className="shrink-0 text-ink-muted" aria-hidden="true" />
          <Select
            aria-label="Environment"
            className="h-9 w-28 text-sm"
            value={environment.name}
            onChange={(e) => void navigate(`/${project.slug}/${e.target.value}`)}
          >
            {environments.map((env) => (
              <option key={env.id} value={env.name}>
                {env.name}
              </option>
            ))}
          </Select>
        </>
      ) : null}
    </div>
  );
}
