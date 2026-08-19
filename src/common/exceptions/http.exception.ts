import { ErrorCodes, HttpCodes } from '../enums';

export class HttpException extends Error {
  public readonly code: ErrorCodes;
  public readonly statusCode: HttpCodes;
  public readonly errors: any[];

  constructor(
    code: ErrorCodes,
    statusCode: HttpCodes,
    message: string,
    errors: any[] = [],
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.errors = errors;
  }

  static BadRequest(code: ErrorCodes, message?: string, errors: any[] = []) {
    return new HttpException(
      code,
      HttpCodes.BadRequest,
      message || 'Bad request',
      errors,
    );
  }

  static Unauthorized(code: ErrorCodes, message?: string, errors: any[] = []) {
    return new HttpException(
      code,
      HttpCodes.Unauthorized,
      message || 'Unauthorized',
      errors,
    );
  }

  static Forbidden(code: ErrorCodes, message?: string, errors: any[] = []) {
    return new HttpException(
      code,
      HttpCodes.Forbidden,
      message || 'Forbidden resource',
      errors,
    );
  }

  static Conflict(code: ErrorCodes, message?: string, errors: any[] = []) {
    return new HttpException(
      code,
      HttpCodes.Conflict,
      message || 'Conflict',
      errors,
    );
  }
}
