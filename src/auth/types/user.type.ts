export interface User {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  added_to_attachment_menu?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
}

export interface ParsedInitData {
  query_id: string;
  user: User;
  auth_date: string;
  signature: string;
  hash: string;
}
