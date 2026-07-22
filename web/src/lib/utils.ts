import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes, resolving conflicts (e.g. a later "p-4" wins over an earlier "p-2"). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
