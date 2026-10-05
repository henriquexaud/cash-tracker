import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";

export function Select(props: ComponentProps<"select">) {
  return (
    <div className="select-control">
      <select {...props} />
      <ChevronDown size={16} aria-hidden="true" />
    </div>
  );
}
