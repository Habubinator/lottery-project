import { PaginateArgs } from '@common/dto';

export interface GetUserGiveawaysArgs extends PaginateArgs {
  userId: string;
  isActive: string;
}
