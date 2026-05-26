import { IsString, IsOptional, IsUUID, MinLength, MaxLength } from 'class-validator'

export class TransferChatDto {
  /** Target employee uuid. Omit / null to return the chat to the общая очередь. */
  @IsOptional() @IsUUID()
  toUserId?: string | null

  @IsString()
  @MinLength(10, { message: 'Комментарий: минимум 10 символов' })
  @MaxLength(1000)
  comment: string
}
