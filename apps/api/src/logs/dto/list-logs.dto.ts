import { IsOptional, IsString } from 'class-validator'

export class ListLogsDto {
  /** action_type enum value, or empty for all. */
  @IsOptional() @IsString()
  action?: string

  @IsOptional() @IsString()
  actorId?: string

  @IsOptional() @IsString()
  dateFrom?: string

  @IsOptional() @IsString()
  dateTo?: string

  @IsOptional() @IsString()
  limit?: string

  @IsOptional() @IsString()
  offset?: string
}
