import { IsString, IsNotEmpty, MaxLength } from 'class-validator'

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  text: string
}
