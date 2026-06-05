import { IsOptional, IsString, MaxLength } from 'class-validator'

/** Filters for the saved close-results view (spec 18). */
export class ResultsQueryDto {
  /** Machine key from close_reasons.value (admin-managed). */
  @IsOptional() @IsString() @MaxLength(50)
  clientStatus?: string

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
