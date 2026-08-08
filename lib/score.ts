export type Priority = {
  label: string
  // tailwind color token base name
  tone: "success" | "warning" | "destructive"
}

export function priorityFor(score: number | null | undefined): Priority {
  const s = score ?? 0
  if (s >= 55) return { label: "High priority", tone: "destructive" }
  if (s >= 30) return { label: "Worth a look", tone: "warning" }
  return { label: "Fairly modern", tone: "success" }
}

export const toneClasses: Record<
  Priority["tone"],
  { text: string; bg: string; bar: string; border: string }
> = {
  success: {
    text: "text-success",
    bg: "bg-success/10",
    bar: "bg-success",
    border: "border-success/30",
  },
  warning: {
    text: "text-warning",
    bg: "bg-warning/10",
    bar: "bg-warning",
    border: "border-warning/30",
  },
  destructive: {
    text: "text-destructive",
    bg: "bg-destructive/10",
    bar: "bg-destructive",
    border: "border-destructive/30",
  },
}
