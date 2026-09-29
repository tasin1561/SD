/**
 * Read the scene markers back out of a recorded file.
 *
 * This is the half that makes the sync correct rather than approximately
 * correct. Playwright's video clock does not track wall time — the file
 * it writes is materially shorter than the session that produced it — so
 * the offsets the recorder measured are the wrong offsets to place audio
 * at. The corner square is the only thing that is true in BOTH clocks:
 * it was set at the instant a scene began, and the frame carrying it is
 * where that scene begins IN THE FILE.
 *
 * Sampling: `fps=25` resamples to the recording rate, `crop=4:4:1:1`
 * takes a 4x4 block from INSIDE the 6x6 square (a one-pixel inset, so a
 * compression artefact at the square's edge cannot be read as its
 * colour), and `rgb24` hands back three bytes a pixel with no further
 * conversion to reason about.
 */
import { spawn } from 'node:child_process';
import { FPS } from './paths.mjs';

const SAMPLE = 4; // crop=4:4:1:1
const BYTES_PER_FRAME = SAMPLE * SAMPLE * 3;

/** Mean colour of the marker block, one entry per frame. */
export function readMarkerTrack(file) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      `fps=${FPS},crop=${SAMPLE}:${SAMPLE}:1:1`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ]);

    /** @type {Buffer[]} */
    const chunks = [];
    let stderr = '';
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0)
        return reject(new Error(`ffmpeg marker read failed: ${stderr.slice(0, 400)}`));
      const buf = Buffer.concat(chunks);
      const frames = Math.floor(buf.length / BYTES_PER_FRAME);
      const track = [];
      for (let f = 0; f < frames; f += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        const base = f * BYTES_PER_FRAME;
        for (let p = 0; p < SAMPLE * SAMPLE; p += 1) {
          r += buf[base + p * 3];
          g += buf[base + p * 3 + 1];
          b += buf[base + p * 3 + 2];
        }
        const n = SAMPLE * SAMPLE;
        track.push([r / n, g / n, b / n]);
      }
      resolve(track);
    });
  });
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The first frame at which a scene's colour is HELD.
 *
 * "Held" matters: a single frame near a colour can be a cross-fade
 * between two markers or a compression wobble, and taking it would place
 * the narration up to a frame early on every scene, which accumulates.
 * Two consecutive frames within tolerance is the smallest evidence that
 * the marker really changed.
 */
export function findSceneStarts(track, colours, { tolerance = 70, hold = 2 } = {}) {
  const starts = [];
  let from = 0;

  for (const [sceneIndex, colour] of colours.entries()) {
    let found = -1;
    for (let f = from; f < track.length - hold; f += 1) {
      let ok = true;
      for (let h = 0; h < hold; h += 1) {
        if (distance(track[f + h], colour) > tolerance) {
          ok = false;
          break;
        }
      }
      if (ok) {
        found = f;
        break;
      }
    }
    if (found === -1) {
      throw new Error(
        `Marker for scene ${sceneIndex} (rgb ${colour.join(',')}) never appears after frame ${from}. ` +
          'The recording is unusable for sync — re-record rather than guessing the offsets.',
      );
    }
    starts.push(found);
    from = found + 1;
  }
  return starts;
}
