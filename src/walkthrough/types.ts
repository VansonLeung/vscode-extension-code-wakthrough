export interface WalkthroughStep {
  file: string;
  lines: [number, number];
  symbol?: string;
  contentHash?: string;
  subtitle: string;
  duration?: number;
}

export interface Walkthrough {
  title: string;
  description: string;
  commitSha?: string;
  steps: WalkthroughStep[];
}

export interface WalkthroughFile {
  uri: string;
  walkthrough: Walkthrough;
}
