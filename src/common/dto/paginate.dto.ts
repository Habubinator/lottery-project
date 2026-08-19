export type PaginateArgs = {
  page: number;
  pageSize: number;
};

export class PaginateDto {
  public readonly page: number;
  public readonly pageSize: number;

  constructor(args: PaginateArgs) {
    this.page = +args?.page || 1;
    this.pageSize = +args?.pageSize || 20;
  }
}
