import { validatorMessage } from '@common/utils';
import { checkSchema } from 'express-validator';

export const paginateValidator = checkSchema({
  page: {
    isNumeric: { errorMessage: validatorMessage('isNumeric') },
    optional: true,
    in: 'query',
  },
  pageSize: {
    isNumeric: { errorMessage: validatorMessage('isNumeric') },
    optional: true,
    in: 'query',
  },
});
