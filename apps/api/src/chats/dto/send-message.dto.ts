import { IsString, IsNotEmpty, IsOptional, IsUUID, MaxLength } from 'class-validator'

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  text: string

  /** UUID of the message being replied to (must belong to the same chat). */
  @IsOptional()
  @IsUUID()
  replyTo?: string
}
