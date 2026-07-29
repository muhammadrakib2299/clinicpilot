import { Construction } from "lucide-react";

import { Card } from "@/components/primitives";

/**
 * A real screen saying a thing is not built, rather than a nav item that
 * silently does nothing when clicked. Same information, but the user learns it
 * in one click instead of concluding the app is broken.
 */
export function NotBuiltPage({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-[1440px] p-6">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>

      <Card className="mt-6 flex max-w-2xl items-start gap-4 p-6">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-muted">
          <Construction className="size-4" />
        </div>
        <div>
          <p className="text-sm font-medium">Not built yet — {phase}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
          <p className="mt-3 text-xs text-muted">
            Roadmap in <span className="font-mono">08-PLAN.md</span>, checklist in{" "}
            <span className="font-mono">09-TODO.md</span>.
          </p>
        </div>
      </Card>
    </div>
  );
}
