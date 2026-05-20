import { IsEnum, IsOptional, IsNumber, IsString, MaxLength } from 'class-validator'

export type ClientStatusValue = 'thinking' | 'consulting' | 'waiting_price' | 'booked' | 'bought'

export class CloseChatDto {
  @IsEnum(['thinking', 'consulting', 'waiting_price', 'booked', 'bought'])
  status!: ClientStatusValue

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
