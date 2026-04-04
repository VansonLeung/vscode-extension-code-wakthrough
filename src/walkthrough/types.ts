export interface WalkthroughStep {
  file: string;
  lines: [number, number];
  symbol?: string;
  contentHash?: string;
  subtitle: string;
  explanation?: string;
  duration?: number;
}

export type WalkthroughRelationType =
  | "related"
  | "prerequisite"
  | "follow-up"
  | "alternative";

export interface WalkthroughRelation {
  path: string;
  title?: string;
  type?: WalkthroughRelationType;
  note?: string;
}

export interface Walkthrough {
  title: string;
  description: string;
  commitSha?: string;
  related?: WalkthroughRelation[];
  steps: WalkthroughStep[];
}

export interface WalkthroughFile {
  uri: string;
  relativePath: string;
  walkthrough: Walkthrough;
}
