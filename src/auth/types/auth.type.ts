import { User, Role } from '@prisma/client';
import { Request } from 'express';

export type AuthorizedUser = Pick<User, 'id' | 'isBanned'> & {
  role: Role;
};

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthorizedUser;
  }
}

export type AuthorizedRequest = Request;
