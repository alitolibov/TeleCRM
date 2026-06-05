import { IsInt, IsOptional, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class UpdateSettingsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440)
  escalationNewMinutes?: number

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440)
  escalationReplyMinutes?: number

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440)
  escalationUnclosedMinutes?: number
}
