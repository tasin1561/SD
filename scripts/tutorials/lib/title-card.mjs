/**
 * The intro and outro cards.
 *
 * Drawn by ffmpeg rather than by the browser so they cost no recording
 * time and cannot drift: they are generated at exactly the output's
 * geometry and frame rate, which is also why they concat cleanly with
 * the retimed body without a re-encode negotiation in the middle.
 *
 * Text is escaped for drawtext, where a colon separates options and a
 * backslash escapes — an unescaped apostrophe silently truncates the
 * line, which reads as "the title card lost half its words".
 */
import { FPS, FRAME_HEIGHT, FRAME_WIDTH } from './paths.mjs';

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const FONT_REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

function escapeText(text) {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '’').replace(/%/g, '\\%');
}

/**
 * A card as a filter_complex chain producing [label].
 * `seconds` includes a fade in and out, so a card shorter than ~1.4s
 * would be mostly fade.
 */
export function cardFilter({ title, subtitle, seconds, label, fontFile = FONT }) {
  const t = escapeText(title);
  const s = escapeText(subtitle);
  const fadeOut = Math.max(0, seconds - 0.5);
  return [
    `color=c=0x0b0f17:s=${FRAME_WIDTH}x${FRAME_HEIGHT}:r=${FPS}:d=${seconds.toFixed(3)}[${label}bg]`,
    `[${label}bg]drawtext=fontfile=${fontFile}:text='${t}':fontcolor=0xf2f6fc:fontsize=76:` +
      `x=(w-text_w)/2:y=(h-text_h)/2-34[${label}t1]`,
    `[${label}t1]drawtext=fontfile=${FONT_REGULAR}:text='${s}':fontcolor=0x7c93b0:fontsize=32:` +
      `x=(w-text_w)/2:y=(h-text_h)/2+58[${label}t2]`,
    `[${label}t2]fade=t=in:st=0:d=0.45,fade=t=out:st=${fadeOut.toFixed(3)}:d=0.5,` +
      `format=yuv420p,setsar=1[${label}]`,
  ].join(';');
}

export const INTRO_SECONDS = 2.6;
export const OUTRO_SECONDS = 2.6;
