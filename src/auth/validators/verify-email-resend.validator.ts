import { validatorMessage } from '@common/utils';
import { checkSchema } from 'express-validator';

export const verifyEmailResendValidator = checkSchema({
  email: {
    isEmail: { errorMessage: validatorMessage('isEmail') },
    notEmpty: { errorMessage: validatorMessage('notEmpty') },
  },
});
