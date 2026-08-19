import SendGridClient from '@sendgrid/mail';
import { MailDto } from './mail.dto';

class MailService {
  constructor() {
    SendGridClient.setApiKey(process.env.SENDGRID_API_KEY);
  }

  async sendMail(dto: MailDto) {
    try {
      await SendGridClient.send({
        ...dto,
        from: process.env.SENDGRID_FROM_MAIL,
      });
    } catch (e: any) {
      console.error(e.response.body);
    }
  }
}

export const mailService = new MailService();
