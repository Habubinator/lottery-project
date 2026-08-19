type MailArgs = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

export class MailDto {
  public readonly to: string;
  public readonly subject: string;
  public readonly text: string;
  public readonly html: string;

  constructor(args: MailArgs) {
    this.to = args.to;
    this.subject = args.subject;
    this.text = args.text;
    this.html = args.html;
  }
}
