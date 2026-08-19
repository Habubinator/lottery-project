import { validatorMessage } from '@common/utils';
import { checkSchema } from 'express-validator';

export const registerValidator = checkSchema({
  name: {
    isString: { errorMessage: validatorMessage('isString') },
    notEmpty: { errorMessage: validatorMessage('notEmpty') },
  },
  email: {
    isEmail: { errorMessage: validatorMessage('isEmail') },
    notEmpty: { errorMessage: validatorMessage('notEmpty') },
  },
  password: {
    isString: { errorMessage: validatorMessage('isString') },
    isLength: {
      errorMessage: validatorMessage('isLength', 8, 64),
      options: { min: 8, max: 64 },
    },
    notEmpty: { errorMessage: validatorMessage('notEmpty') },
  },
});
