import { Roles } from '@auth/enums';
import { checkSchema } from 'express-validator';

export const getAllPermissionsValidator = checkSchema({
  roleId: {
    in: 'query',
    isIn: {
      options: [[Roles.Admin]],
    },
    optional: true,
  },
});
