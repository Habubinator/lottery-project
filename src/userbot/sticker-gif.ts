import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import zlib from 'zlib';

const execFileAsync = promisify(execFile);

let loggedMissingLottieTools = false;

function logMissingLottieToolsOnce(message: string): void {
  if (loggedMissingLottieTools) return;
  loggedMissingLottieTools = true;
  console.warn(
    `[Userbot] ${message} — install ffmpeg + lottie_to_png (lottie-converter). See docs/sticker-gif-server-setup.md`,
  );
}

const GIF_SIZE = 256;
const GIF_FPS = 24;
const MAX_RENDER_FRAMES = 90;

const LOTTIE_BIN_DIRS = [
  '/opt/lottie-converter/bin',
  '/usr/local/lib/lottie-converter/bin',
];

function lottieToPngCandidates(): string[] {
  const names = ['lottie_to_png'];
  const out: string[] = [];
  for (const dir of LOTTIE_BIN_DIRS) {
    for (const name of names) {
      out.push(path.join(dir, name));
    }
  }
  for (const name of names) {
    out.push(name);
  }
  return out;
}

export function publicStickerPathToLocal(publicPath: string): string {
  const rel = publicPath.replace(/^\/static\/?/, '');
  return path.join(process.env.MULTER_DEST ?? 'static', rel);
}

function publicPathForLocalFile(localPath: string): string {
  const staticRoot = path.resolve(process.env.MULTER_DEST ?? 'static');
  const rel = path.relative(staticRoot, localPath).split(path.sep).join('/');
  return `/static/${rel}`;
}

function fileExistsAndNonEmpty(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function posterLocalPathForSource(localSourcePath: string): string {
  const ext = path.extname(localSourcePath).toLowerCase();
  const base = path.basename(localSourcePath, ext);
  return path.join(path.dirname(localSourcePath), `${base}-poster.png`);
}

function gifLocalPathForSource(localSourcePath: string): string {
  const ext = path.extname(localSourcePath).toLowerCase();
  const base = path.basename(localSourcePath, ext);
  return path.join(path.dirname(localSourcePath), `${base}.gif`);
}

async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync('ffmpeg', args, { timeout: 180_000 });
}

function readLottieFrameCount(jsonBuffer: Buffer): number {
  try {
    const data = JSON.parse(jsonBuffer.toString('utf8')) as {
      fr?: number;
      ip?: number;
      op?: number;
    };
    const fr = data.fr && data.fr > 0 ? data.fr : GIF_FPS;
    const ip = data.ip ?? 0;
    const op = data.op ?? ip + fr * 2;
    const frames = Math.ceil(op - ip);
    return Math.min(Math.max(frames, 1), MAX_RENDER_FRAMES);
  } catch {
    return Math.min(GIF_FPS * 2, MAX_RENDER_FRAMES);
  }
}

function gifPaletteFilter(): string {
  return [
    `fps=${GIF_FPS}`,
    `scale=${GIF_SIZE}:${GIF_SIZE}:force_original_aspect_ratio=decrease:flags=lanczos`,
    'split[s0][s1]',
    '[s0]palettegen=max_colors=128:reserve_transparent=1[p]',
    '[s1][p]paletteuse=dither=bayer:bayer_scale=3',
  ].join(',');
}

async function extractGifFirstFrame(
  localGifPath: string,
  localPosterPath: string,
): Promise<boolean> {
  if (fileExistsAndNonEmpty(localPosterPath)) {
    return true;
  }
  try {
    await runFfmpeg([
      '-y',
      '-loglevel',
      'error',
      '-i',
      localGifPath,
      '-frames:v',
      '1',
      localPosterPath,
    ]);
    return fileExistsAndNonEmpty(localPosterPath);
  } catch {
    return false;
  }
}

async function convertTgsToGif(
  tgsPath: string,
  gifPath: string,
  posterPath: string,
): Promise<boolean> {
  const tmpDir = `${gifPath}.${process.pid}.frames`;
  const jsonPath = path.join(tmpDir, 'animation.json');

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const jsonBuffer = zlib.gunzipSync(fs.readFileSync(tgsPath));
    fs.writeFileSync(jsonPath, jsonBuffer);

    let rendered = false;
    for (const cli of lottieToPngCandidates()) {
      try {
        await execFileAsync(
          cli,
          [
            '--width',
            String(GIF_SIZE),
            '--height',
            String(GIF_SIZE),
            '--fps',
            String(GIF_FPS),
            '--output',
            tmpDir,
            jsonPath,
          ],
          { timeout: 120_000 },
        );
        rendered = true;
        break;
      } catch {
        // try next path
      }
    }

    if (!rendered) {
      logMissingLottieToolsOnce('lottie_to_png unavailable');
      return false;
    }

    const framePattern = path.join(tmpDir, '%03d.png');
    const firstFrame = path.join(tmpDir, '001.png');
    if (!fs.existsSync(firstFrame)) {
      console.warn(
        `[Userbot] lottie_to_png produced no frames for ${path.basename(tgsPath)}`,
      );
      return false;
    }

    fs.copyFileSync(firstFrame, posterPath);

    const frameCount = readLottieFrameCount(jsonBuffer);
    await runFfmpeg([
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      String(GIF_FPS),
      '-start_number',
      '1',
      '-i',
      framePattern,
      '-frames:v',
      String(frameCount),
      '-an',
      '-vf',
      gifPaletteFilter(),
      '-loop',
      '0',
      gifPath,
    ]);

    return fileExistsAndNonEmpty(gifPath);
  } catch (e) {
    console.warn(
      `[Userbot] TGS→GIF failed ${path.basename(tgsPath)}:`,
      e instanceof Error ? e.message : e,
    );
    return false;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export type StickerGifAssets = {
  gifPath: string | null;
  posterPath: string | null;
};

/**
 * Build `{base}.gif` and static `{base}-poster.png` (first animation frame) from `.tgs`.
 */
export async function ensureStickerGifAssets(
  localSourcePath: string,
): Promise<StickerGifAssets> {
  const empty = { gifPath: null, posterPath: null };
  if (!localSourcePath || !fs.existsSync(localSourcePath)) {
    return empty;
  }

  const ext = path.extname(localSourcePath).toLowerCase();
  if (ext !== '.tgs') {
    return empty;
  }

  const localGif = gifLocalPathForSource(localSourcePath);
  const localPoster = posterLocalPathForSource(localSourcePath);

  if (fileExistsAndNonEmpty(localGif)) {
    const gifPath = publicPathForLocalFile(localGif);
    if (!fileExistsAndNonEmpty(localPoster)) {
      await extractGifFirstFrame(localGif, localPoster);
    }
    const posterPath = fileExistsAndNonEmpty(localPoster)
      ? publicPathForLocalFile(localPoster)
      : null;
    return { gifPath, posterPath };
  }

  const ok = await convertTgsToGif(localSourcePath, localGif, localPoster);
  return {
    gifPath: ok ? publicPathForLocalFile(localGif) : null,
    posterPath: fileExistsAndNonEmpty(localPoster)
      ? publicPathForLocalFile(localPoster)
      : null,
  };
}

/** @deprecated Prefer ensureStickerGifAssets for poster + gif */
export async function ensureStickerGifPublicPath(
  localSourcePath: string,
): Promise<string | null> {
  const { gifPath } = await ensureStickerGifAssets(localSourcePath);
  return gifPath;
}
