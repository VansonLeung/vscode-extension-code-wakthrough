import * as vscode from "vscode";
import { Walkthrough, WalkthroughStep } from "../walkthrough/types";

export type PlaybackState = "idle" | "playing" | "paused";

export const SPEED_OPTIONS = [0.5, 1, 2, 3] as const;
export type SpeedMultiplier = (typeof SPEED_OPTIONS)[number];

export interface PlaybackStatus {
  state: PlaybackState;
  currentIndex: number;
  totalSteps: number;
  currentStep: WalkthroughStep | null;
  walkthrough: Walkthrough | null;
  speed: SpeedMultiplier;
}

export class PlaybackEngine {
  private walkthrough: Walkthrough | null = null;
  private currentIndex = 0;
  private state: PlaybackState = "idle";
  private autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private defaultDuration = 8;
  private speed: SpeedMultiplier = 1;

  private readonly onChangeEmitter = new vscode.EventEmitter<PlaybackStatus>();
  readonly onChange = this.onChangeEmitter.event;

  load(walkthrough: Walkthrough): void {
    this.stop();
    this.walkthrough = walkthrough;
    this.currentIndex = 0;
    this.state = "paused";
    this.emit();
  }

  play(): void {
    if (!this.walkthrough || this.walkthrough.steps.length === 0) {
      return;
    }
    this.state = "playing";
    this.emit();
    this.scheduleAutoAdvance();
  }

  pause(): void {
    this.state = "paused";
    this.clearAutoAdvance();
    this.emit();
  }

  togglePlayback(): void {
    if (this.state === "playing") {
      this.pause();
    } else if (this.state === "paused") {
      this.play();
    }
  }

  next(): boolean {
    if (!this.walkthrough) {
      return false;
    }
    if (this.currentIndex >= this.walkthrough.steps.length - 1) {
      this.pause();
      return false;
    }
    this.currentIndex++;
    this.emit();
    if (this.state === "playing") {
      this.scheduleAutoAdvance();
    }
    return true;
  }

  prev(): boolean {
    if (!this.walkthrough || this.currentIndex <= 0) {
      return false;
    }
    this.currentIndex--;
    this.emit();
    if (this.state === "playing") {
      this.scheduleAutoAdvance();
    }
    return true;
  }

  goTo(index: number): void {
    if (!this.walkthrough) {
      return;
    }
    if (index < 0 || index >= this.walkthrough.steps.length) {
      return;
    }
    this.currentIndex = index;
    this.emit();
    if (this.state === "playing") {
      this.scheduleAutoAdvance();
    }
  }

  setSpeed(speed: SpeedMultiplier): void {
    this.speed = speed;
    this.emit();
    if (this.state === "playing") {
      this.scheduleAutoAdvance();
    }
  }

  cycleSpeed(): void {
    const idx = SPEED_OPTIONS.indexOf(this.speed);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    this.setSpeed(next);
  }

  getSpeed(): SpeedMultiplier {
    return this.speed;
  }

  stop(): void {
    this.clearAutoAdvance();
    this.walkthrough = null;
    this.currentIndex = 0;
    this.state = "idle";
    this.speed = 1;
    this.emit();
  }

  getStatus(): PlaybackStatus {
    return {
      state: this.state,
      currentIndex: this.currentIndex,
      totalSteps: this.walkthrough?.steps.length ?? 0,
      currentStep: this.walkthrough?.steps[this.currentIndex] ?? null,
      walkthrough: this.walkthrough,
      speed: this.speed,
    };
  }

  private emit(): void {
    this.onChangeEmitter.fire(this.getStatus());
  }

  private scheduleAutoAdvance(): void {
    this.clearAutoAdvance();
    if (this.state !== "playing" || !this.walkthrough) {
      return;
    }
    const step = this.walkthrough.steps[this.currentIndex];
    const duration = ((step.duration ?? this.defaultDuration) / this.speed) * 1000;
    this.autoAdvanceTimer = setTimeout(() => {
      this.next();
    }, duration);
  }

  private clearAutoAdvance(): void {
    if (this.autoAdvanceTimer !== null) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
  }

  dispose(): void {
    this.stop();
    this.onChangeEmitter.dispose();
  }
}
