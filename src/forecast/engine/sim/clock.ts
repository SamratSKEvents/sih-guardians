// Playback clock: converts wall-clock time into a whole number of fixed physics steps.
// Playback speed never changes the physics dt: 600× with dt = 60 s is ten 60-s steps per wall second.

export const PLAYBACK_SPEEDS = [1, 10, 60, 600, 3600] as const;

export class PlaybackClock {
  speed = 60; // simulated seconds per wall-clock second
  private accumulator = 0; // simulated seconds owed

  /** How many steps of `dt` to take after `wallSeconds` elapsed; at most maxSteps (excess debt is dropped, not batched). */
  advance(wallSeconds: number, dt: number, maxSteps: number): number {
    this.accumulator += Math.min(wallSeconds, 0.25) * this.speed;
    let n = Math.floor(this.accumulator / dt);
    if (n > maxSteps) {
      n = maxSteps;
      this.accumulator = 0; // running behind: drop the debt instead of spiralling
    } else {
      this.accumulator -= n * dt;
    }
    return n;
  }

  clear(): void {
    this.accumulator = 0;
  }
}
