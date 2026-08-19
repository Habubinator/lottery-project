import { validatorMessage } from '@common/utils';
import { checkSchema } from 'express-validator';

export const telegramSessionValidator = checkSchema({
  initData: {
    in: 'body',
    isString: { errorMessage: validatorMessage('isString') },
    notEmpty: { errorMessage: validatorMessage('notEmpty') },
  },
});
