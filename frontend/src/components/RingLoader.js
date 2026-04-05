import { cn } from "../lib/utils";

/** Circular ring spinner for loading states. */
export default function RingLoader({ className = "", size = "md", label }) {
  const sz = size === "sm" ? "w-6 h-6 border-2" : size === "lg" ? "w-12 h-12 border-[3px]" : "w-9 h-9 border-[3px]";
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2", className)} role="status" aria-label={label || "Loading"}>
      <div
        className={cn(
          "rounded-full border-[#C8102E] border-t-transparent animate-spin",
          sz
        )}
      />
      {label ? <span className="text-xs text-gray-500">{label}</span> : null}
    </div>
  );
}
