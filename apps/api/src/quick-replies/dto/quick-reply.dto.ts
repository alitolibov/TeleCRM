import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator'

export class CreateQuickReplyDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string

  @IsString() @IsNotEmpty() @MaxLength(2000)
  body: string
}

export class UpdateQuickReplyDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50)
  name?: string

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(2000)
  body?: string
}
