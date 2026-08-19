export type CreateTemplateArgs = {
  giveawayId: string;
  name?: string;
};

export class CreateTemplateDto {
  public readonly giveawayId: string;
  public readonly name?: string;

  constructor(args: CreateTemplateArgs) {
    if (!args.giveawayId) {
      throw new Error('giveawayId is required');
    }

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(args.giveawayId)) {
      throw new Error('giveawayId must be a valid UUID');
    }

    this.giveawayId = args.giveawayId;

    // Validate name if provided
    if (args.name !== undefined) {
      if (typeof args.name !== 'string') {
        throw new Error('name must be a string');
      }
      const trimmed = args.name.trim();
      if (trimmed.length === 0) {
        this.name = undefined; // Empty string becomes undefined
      } else if (trimmed.length > 100) {
        throw new Error('name must be 100 characters or less');
      } else {
        this.name = trimmed;
      }
    }
  }
}
