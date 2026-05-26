import { IsOptional, IsString, IsIn } from 'class-validator'

/** Filters for the saved close-results view (spec 18). */
export class ResultsQueryDto {
  @IsOptional() @IsIn(['thinking', 'consulting', 'waiting_price', 'booked', 'bought'])
  clientStatus?: 'thinking' | 'consulting' | 'waiting_price' | 'booked' | 'bought'

  /** Responsible manager uuid (admin-only filter). */
  @IsOptional() @IsString()
  assignedTo?: string

  /** Close-date range (ISO) — matched against when the result was saved. */
  @IsOptional() @IsString()
  dateFrom?: string

  @IsOptional() @IsString()
  dateTo?: string

  /** Search across flight, dates, amount and comment. */
  @IsOptional() @IsString()
  q?: string

  @IsOptional() @IsString()
  limit?: string
}
