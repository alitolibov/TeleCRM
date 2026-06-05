import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator'

export class CloseChatDto {
  /** Machine key — must match an existing row in close_reasons.value. */
  @IsString() @IsNotEmpty() @MaxLength(50)
  status!: string

  @IsOptional() @IsString() @MaxLength(100)
  flightFrom?: string

  @IsOptional() @IsString() @MaxLength(100)
  flightTo?: string

  @IsOptional() @IsString() @MaxLength(200)
  dates?: string

  @IsOptional() @IsNumber()
  amount?: number

  @IsOptional() @IsString() @MaxLength(2000)
  comment?: string
}
