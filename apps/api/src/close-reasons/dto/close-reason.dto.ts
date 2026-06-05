import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator'

export class CreateCloseReasonDto {
  /** Machine key persisted to chat_results.client_status. */
  @IsString() @IsNotEmpty() @MaxLength(50)
  @Matches(/^[a-z0-9_]+$/, { message: 'value must use lowercase latin letters, digits and underscores' })
  value!: string

  @IsString() @IsNotEmpty() @MaxLength(100)
  label!: string

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number
}

export class UpdateCloseReasonDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  label?: string

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number
}

export class ReorderCloseReasonsDto {
  @IsString({ each: true })
  ids!: string[]
}
