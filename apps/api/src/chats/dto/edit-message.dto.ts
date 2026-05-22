import { IsString, MaxLength } from 'class-validator'

export class EditMessageDto {
  @IsString()
  @MaxLength(4096)
  text: string
}
