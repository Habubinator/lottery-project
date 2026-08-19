import { listenEvent } from '@common/utils';
import { MAIL_SEND } from './mail.constants';
import { MailDto } from './mail.dto';
import { mailService } from './mail.service';

class MailListener {
  initialize() {
    listenEvent(MAIL_SEND, (dto: MailDto) => {
      mailService.sendMail(dto);
    });

    console.log('Mail listener initialized');
  }
}

export const mailListener = new MailListener();
