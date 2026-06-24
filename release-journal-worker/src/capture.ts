// capture — adapter that drives capture.ps1 (Release Journal Worker · Phase 3).
//
// The scheduler calls a `Capturer` (view, outPath) => Promise<void>. The real
// adapter spawns ../capture/capture.ps1 (native Windows screen capture); tests
// inject a stub that writes a placeholder file. No npm dependencies.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type ScreenshotType =
  | 'PRE_RELEASE' | 'RELEASE_NUMBERS' | 'RELEASE_IMPULSE' | 'PEAK_1'
  | 'MAE_BETWEEN_PEAKS' | 'PEAK_2' | 'HOLDING_END' | 'COMPOSITE' | 'OTHER';

// What screen area a view captures.
export type CaptureTarget =
  | { monitor: number }                               // 0-based screen index
  | { region: { x: number; y: number; w: number; h: number } }
  | { full: true };                                   // whole virtual desktop

// A configured capture surface. `asset` ties it to a symbol's chart (so event
// captures and filing know where it belongs); omit `asset` for a global view
// (RELEASE_NUMBERS / COMPOSITE), giving it `globalType`.
export type CaptureView = {
  id: string;                  // unique; used in staging filenames
  target: CaptureTarget;
  asset?: string;              // symbol this chart view belongs to
  globalType?: ScreenshotType; // type for non-asset views (default OTHER)
  offsetsSec?: number[];       // restrict a global view to specific fixed offsets
  notes?: string;
};

export type Capturer = (view: CaptureView, outPath: string) => Promise<void>;

// Real capturer: spawns capture.ps1 once per frame.
export function makePowershellCapturer(scriptPath: string): Capturer {
  return (view, outPath) => new Promise((resolve, reject) => {
    const args = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Out', outPath, '-Quiet'];
    const t = view.target as any;
    if (t && t.region) {
      args.push('-X', String(t.region.x), '-Y', String(t.region.y), '-W', String(t.region.w), '-H', String(t.region.h));
    } else if (t && typeof t.monitor === 'number') {
      args.push('-Monitor', String(t.monitor));
    } // else full → no extra args (capture.ps1 defaults to the virtual desktop)

    const proc = spawn('powershell', args, { windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => { err += String(d); });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`capture.ps1 exit ${code}: ${err.trim()}`)));
  });
}

// Test/sim capturer: writes a tiny placeholder file instead of a real screenshot.
export function makeStubCapturer(): Capturer {
  return async (_view, outPath) => {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, 'placeholder');
  };
}
