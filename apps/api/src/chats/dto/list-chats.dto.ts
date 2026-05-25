import { IsOptional, IsString, IsIn } from 'class-validator'

/**
 * Query params for GET /chats. Values arrive as strings (no transform pipe);
 * the service parses `limit` and interprets `assignedTo === 'unassigned'`.
 */
export class ListChatsDto {
  @IsOptional() @IsString()
  limit?: string

  @IsOptional() @IsString()
  cursor?: string

  @IsOptional() @IsIn(['new', 'active', 'closed'])
  status?: 'new' | 'active' | 'closed'

  /** A manager's uuid, or the literal 'unassigned'. Admin-only; ignored for managers. */
  @IsOptional() @IsString()
  assignedTo?: string

  /** ISO date — chats whose last-message date is on/after this. */
  @IsOptional() @IsString()
  dateFrom?: string

  /** ISO date — chats whose last-message date is on/before this. */
  @IsOptional() @IsString()
  dateTo?: string

  /** Search across client name/username and message text. */
  @IsOptional() @IsString()
  q?: string
}
