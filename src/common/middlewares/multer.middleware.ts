import multer from 'multer';
import { extname, join } from 'path';
import { v4 } from 'uuid';

export const uploadSingleFile = (
  folder: string,
  fieldname: string,
  options?: { fileFormats: string[]; sizeLimit: number },
) =>
  multer({
    storage: multer.diskStorage({
      destination: join(process.env.MULTER_DEST, folder),
      filename: (_, file, callback) => {
        if (file) {
          callback(null, `${v4()}${extname(file.originalname)}`);
        }
      },
    }),
    fileFilter: options?.fileFormats
      ? (_, file, callback) => {
          callback(
            null,
            options.fileFormats.includes(
              extname(file.originalname).toLowerCase(),
            ),
          );
        }
      : undefined,
    limits: {
      fileSize: options?.sizeLimit,
    },
  }).single(fieldname);

export const uploadFilesByFields = (folder: string, fields: multer.Field[]) =>
  multer({
    storage: multer.diskStorage({
      destination: join(process.env.MULTER_DEST, folder),
      filename: (_, file, callback) => {
        if (file) {
          callback(null, `${v4()}${extname(file.originalname)}`);
        }
      },
    }),
  }).fields(fields);

export const uploadMultipleFiles = (
  folder: string,
  fieldname: string,
  maxCount: number,
  options?: { fileFormats: string[]; sizeLimit: number },
) =>
  multer({
    storage: multer.diskStorage({
      destination: join(process.env.MULTER_DEST, folder),
      filename: (_, file, callback) => {
        if (file) {
          callback(null, `${v4()}${extname(file.originalname)}`);
        }
      },
    }),
    fileFilter: options?.fileFormats
      ? (_, file, callback) => {
          callback(
            null,
            options.fileFormats.includes(
              extname(file.originalname).toLowerCase(),
            ),
          );
        }
      : undefined,
    limits: {
      fileSize: options?.sizeLimit,
    },
  }).array(fieldname, maxCount);
