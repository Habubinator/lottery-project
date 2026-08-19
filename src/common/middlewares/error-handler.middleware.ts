import type { NextFunction, Request, Response } from 'express';
import { ErrorCodes, HttpCodes } from '../enums';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _: NextFunction,
) => {
  const statusCode = err.statusCode || HttpCodes.InternalServerError;
  const isPrismaError =
    `${err?.code || ''}`.startsWith('P') ||
    `${err?.name || ''}`.startsWith('Prisma');

  if (
    err.code !== ErrorCodes.Validation &&
    ![401, 403, 404, 429].includes(err.statusCode)
  ) {
    console.log(err);
  }

  res.status(statusCode).json({
    success: false,
    code: isPrismaError ? undefined : err?.code,
    statusCode,
    message: isPrismaError ? 'Internal server error' : err?.message,
    errors: err?.errors || [],
    path: req.path,
    timestamp: new Date(),
  });
};
