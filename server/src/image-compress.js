/**
 * 上传图片压缩（后台可开关）
 *
 * - 只处理 JPG / PNG / WebP / AVIF 静态图，统一转成 WebP
 * - 自动纠正手机照片的 EXIF 方向，并按最长边等比缩小
 * - GIF / SVG / 多帧动图直接跳过，避免把动画压成静帧、把矢量图栅格化
 * - 压缩后反而更大时保留原图
 * - 压缩失败只记日志，不影响正常上传
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/**
 * @param {Express.Multer.File} file multer 落盘后的文件对象（会被原地更新）
 * @param {Record<string, string>} settings 站点设置
 * @returns {Promise<null | { size: number, originalSize: number }>} 未压缩返回 null
 */
export async function compressImage(file, settings = {}) {
  if (String(settings.image_compress ?? '1') !== '1') return null;
  if (!file?.path || !SUPPORTED.has(String(file.mimetype).toLowerCase())) return null;

  const maxSide = clamp(settings.image_max_side, 1280, 3840, 2560);
  const quality = clamp(settings.image_quality, 60, 95, 82);
  const parsed = path.parse(file.path);
  const tmpPath = path.join(parsed.dir, `${parsed.name}.out.webp`);

  try {
    const meta = await sharp(file.path, { limitInputPixels: 100_000_000 }).metadata();
    if (!meta.width || !meta.height) return null;
    // 多帧图片（动图 WebP / APNG）不压，保留动画
    if ((meta.pages || 1) > 1) return null;
    // 本来就小且没超尺寸，转码收益很低，直接保留原图
    if (file.size < 150 * 1024 && meta.width <= maxSide && meta.height <= maxSide) return null;

    await sharp(file.path, { limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 4, smartSubsample: true })
      .toFile(tmpPath);

    const [origStat, outStat] = await Promise.all([fs.stat(file.path), fs.stat(tmpPath)]);
    if (outStat.size >= origStat.size) {
      await fs.unlink(tmpPath);
      return null;
    }

    // 原图是 webp 时直接覆盖，其他格式改成同名 .webp
    const finalPath = parsed.ext.toLowerCase() === '.webp' ? file.path : path.join(parsed.dir, `${parsed.name}.webp`);
    if (finalPath !== file.path) await fs.unlink(file.path);
    await fs.rename(tmpPath, finalPath);

    file.path = finalPath;
    file.filename = path.basename(finalPath);
    file.size = outStat.size;
    file.mimetype = 'image/webp';

    return { size: outStat.size, originalSize: origStat.size };
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    console.error('[image-compress]', err.message);
    return null;
  }
}
