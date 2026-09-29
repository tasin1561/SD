/** Where everything lives, in one place so no two scripts can disagree. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const TUTORIALS_DIR = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(TUTORIALS_DIR, '..', '..');

/** Generated media. Gitignored — scripts are committed, mp4s are not. */
export const OUT_DIR = path.join(TUTORIALS_DIR, 'out');
export const AUDIO_DIR = path.join(OUT_DIR, 'audio');
export const RAW_DIR = path.join(OUT_DIR, 'raw');
export const WORK_DIR = path.join(OUT_DIR, 'work');
export const VERIFY_DIR = path.join(OUT_DIR, 'verify');

/** The recording canvas. 8 extra rows carry the sync marker and are cropped off. */
export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;
export const MARKER_STRIP = 8;
export const CANVAS_HEIGHT = FRAME_HEIGHT + MARKER_STRIP;

/** Playwright records at 25fps; the marker reader samples at the same rate. */
export const FPS = 25;

/** Narration length window — clips outside it are flagged, not rejected. */
export const MIN_CLIP_SECONDS = 8;
export const MAX_CLIP_SECONDS = 15;
