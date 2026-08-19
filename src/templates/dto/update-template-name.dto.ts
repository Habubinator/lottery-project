export type UpdateTemplateNameArgs = {
  name?: string;
};

export class UpdateTemplateNameDto {
  public readonly name?: string;

  constructor(args: UpdateTemplateNameArgs) {
    // Validate name if provided
    if (args.name !== undefined) {
      if (typeof args.name !== 'string') {
        throw new Error('name must be a string');
      }
      const trimmed = args.name.trim();
      if (trimmed.length === 0) {
        this.name = undefined; // Empty string clears the name
      } else if (trimmed.length > 100) {
        throw new Error('name must be 100 characters or less');
      } else {
        this.name = trimmed;
      }
    }
  }
}
