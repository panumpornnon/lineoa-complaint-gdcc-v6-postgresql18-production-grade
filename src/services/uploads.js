import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';

import config from '../config.js';
import { ApiError } from '../errors.js';

const allowedDeclaredMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function imageFileFilter(req, file, callback) {
  if (!allowedDeclaredMimeTypes.has(file.mimetype.toLowerCase())) {
    return callback(
      new ApiError(
        400,
        `ไฟล์ “${safeOriginalName(file.originalname)}” เป็นชนิดที่ไม่รองรับ กรุณาใช้ JPEG, PNG, WebP, HEIC หรือ HEIF`,
      ),
    );
  }
  return callback(null, true);
}

function createImageUpload(fileSizeMb) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      files: config.maxUploadFiles,
      fileSize: fileSizeMb * 1024 * 1024,
      fields: 20,
    },
    fileFilter: imageFileFilter,
  }).array('images', config.maxUploadFiles);
}

export const uploadComplaintImages = createImageUpload(config.maxUploadMb);

export const uploadStaffWorkImages = createImageUpload(config.maxUploadMb);

export async function ensureUploadDirectory() {
  await fs.mkdir(config.uploadDir, { recursive: true, mode: 0o750 });
}

function safeOriginalName(value) {
  return path.basename(value || 'image').replace(/[\u0000-\u001f]/g, '').slice(0, 255);
}

export async function processAndStoreImages(files = []) {
  await ensureUploadDirectory();
  const stored = [];

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];

      let output;
      try {
        output = await sharp(file.buffer, {
          failOn: 'error',
          limitInputPixels: 50_000_000,
          sequentialRead: true,
        })
          .rotate()
          .resize({
            width: config.maxImageDimension,
            height: config.maxImageDimension,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({
            quality: config.jpegQuality,
            progressive: true,
            mozjpeg: true,
          })
          .toBuffer({ resolveWithObject: true });
      } catch {
        throw new ApiError(
          400,
          `ไฟล์ “${safeOriginalName(file.originalname)}” ไม่ใช่ภาพที่ระบบอ่านได้ หรือรูปแบบ HEIC/HEIF นี้ไม่รองรับ`,
        );
      }

      const storageKey = `${crypto.randomUUID()}.jpg`;
      const targetPath = path.join(config.uploadDir, storageKey);
      const sha256 = crypto.createHash('sha256').update(output.data).digest('hex');

      await fs.writeFile(targetPath, output.data, {
        mode: 0o640,
        flag: 'wx',
      });

      stored.push({
        storageKey,
        absolutePath: targetPath,
        originalName: safeOriginalName(file.originalname),
        mimeType: 'image/jpeg',
        sizeBytes: output.info.size,
        width: output.info.width,
        height: output.info.height,
        sha256,
        sortOrder: index,
      });
    }

    return stored;
  } catch (error) {
    await cleanupStoredImages(stored);
    throw error;
  }
}

export async function cleanupStoredImages(images = []) {
  await Promise.all(
    images.map(async (image) => {
      try {
        await fs.unlink(image.absolutePath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Unable to remove image after rollback:', error);
        }
      }
    }),
  );
}

export async function cleanupStoredImageKeys(storageKeys = []) {
  const images = storageKeys.flatMap((storageKey) => {
    try {
      return [{ absolutePath: resolveStoredImagePath(storageKey) }];
    } catch (error) {
      console.error('Unable to resolve stored image for cleanup:', error);
      return [];
    }
  });

  await cleanupStoredImages(images);
}

export function resolveStoredImagePath(storageKey) {
  if (!/^[0-9a-f-]{36}\.jpg$/i.test(storageKey)) {
    throw new ApiError(404, 'ไม่พบรูปภาพ');
  }

  const uploadRoot = path.resolve(config.uploadDir);
  const absolutePath = path.resolve(uploadRoot, storageKey);

  if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new ApiError(404, 'ไม่พบรูปภาพ');
  }

  return absolutePath;
}

export function sendStoredImage(res, attachment) {
  const absolutePath = resolveStoredImagePath(attachment.storage_key);

  res.set({
    'Cache-Control': 'private, max-age=3600',
    'Content-Type': attachment.mime_type,
    'Content-Disposition': `inline; filename="${attachment.id}.jpg"`,
    'X-Content-Type-Options': 'nosniff',
  });

  return res.sendFile(absolutePath, (error) => {
    if (error && !res.headersSent) {
      res.status(error.code === 'ENOENT' ? 404 : 500).json({
        success: false,
        message: error.code === 'ENOENT' ? 'ไม่พบไฟล์รูปภาพ' : 'ไม่สามารถอ่านรูปภาพได้',
      });
    }
  });
}
