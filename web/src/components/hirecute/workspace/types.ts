import type { ComponentType } from "react";
import type { JobId, StageId } from "@/lib/hirecute/contracts";
import type { PublicConfig } from "@/lib/hirecute/config";
import type { Flow } from "@/lib/hirecute/flow.mjs";
import type { LetterMap } from "@/lib/hirecute/letters";
import type { PresentationState } from "@/lib/hirecute/presentation";
import type { RunState } from "@/lib/hirecute/run-store";
import type { LocalStep, StageReceipt } from "../agent-transcript";

/** What the journey hands the workspace: server actions and letter edits. */
export interface JourneyActions {
  letters: LetterMap;
  onLettersChange: (next: LetterMap) => void;
  onSelectionChange: (ids: JobId[]) => void;
  onSaveLetter: (id: JobId) => void;
  onAcceptResume: (appliedRecommendationIds: string[], excludedItems: string[]) => Promise<boolean>;
  onRestart: () => void;
}

/**
 * How a screen reaches the persistent shell without the shell knowing which
 * screen it is: a browser-side step for the transcript and stepper, a modal
 * that makes the shell inert, and where to portal that modal so it renders as
 * the shell's sibling (outside the inert subtree).
 */
export interface ShellApi {
  setLocalStep: (step: LocalStep | null) => void;
  setInert: (on: boolean) => void;
  overlayRoot: HTMLElement | null;
}

export interface ScreenProps {
  flow: Flow;
  runState: RunState;
  presentation: PresentationState;
  /** The stage on screen; may lag the worker while a result dwells. */
  shownStage: StageId | null;
  publicConfig: PublicConfig;
  reducedMotion: boolean;
  actions: JourneyActions;
  shell: ShellApi;
}

export interface ReceiptContext {
  runState: RunState;
  presentation: PresentationState;
}

/**
 * A registry entry: the screen, and the transcript receipt of each stage it
 * presents (receipt copy belongs with the screen that showed the result).
 */
export interface ScreenModule {
  Screen: ComponentType<ScreenProps>;
  receipts?: Partial<Record<StageId, (ctx: ReceiptContext) => StageReceipt | null>>;
}
