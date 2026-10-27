import type { ComponentType } from "react";
import { RecruiterShowcase } from "../recruiter-showcase";
import { HeroBlock } from "./hero";
import { UploadBlock } from "./upload";
import {
  ControlBlock,
  FaqBlock,
  FeaturesBlock,
  FinaleBlock,
  PricingBlock,
  StartupsBlock,
} from "./sections";
import type { BlockProps } from "./types";

/**
 * The React half of the landing block registry: block id → component. The
 * data half (each block's strings, anchor and options) is BLOCKS in
 * lib/hirecute/landing-content.mjs; a test fails if the two disagree.
 *
 * A scenario's landing is its `landing.blocks` list rendered in order, so a
 * new layout is a JSON edit and a new kind of block is a component here plus
 * its entry in BLOCKS.
 */
export const LANDING_BLOCKS: Record<string, ComponentType<BlockProps>> = {
  hero: HeroBlock,
  upload: UploadBlock,
  recruiters: RecruiterShowcase,
  startups: StartupsBlock,
  features: FeaturesBlock,
  control: ControlBlock,
  pricing: PricingBlock,
  faq: FaqBlock,
  finale: FinaleBlock,
};
