import type { RefObject } from "react";
import type { LandingBlock, LandingStrings } from "@/lib/hirecute/landing-content.mjs";

/** What the landing shell hands every block. */
export interface LandingActions {
  /** Opens the file picker (the hidden input lives in the upload block). */
  chooseFile: () => void;
  startSample: () => void;
  acceptFile: (file: File | undefined) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Server or client-side upload error, shown beside the drop zone. */
  error: string | null;
  maxMb: number;
}

export interface BlockProps {
  s: LandingStrings;
  config: LandingBlock;
  actions: LandingActions;
}

export interface LinkItem {
  label: string;
  href: string | null;
}
export interface ActivityRow {
  marker: string;
  task: string;
  agent: string;
  state: string;
}
export interface FeatureItem {
  art: string;
  title: string;
  body: string;
}
export interface ControlItem {
  num: string;
  title: string;
  body: string;
}
export interface FaqItem {
  q: string;
  a: string;
}
