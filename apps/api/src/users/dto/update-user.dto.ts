import { IsString, IsOptional, IsIn, MaxLength, MinLength, Matches } from 'class-validator'

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string

  @IsOptional()
  @IsString()
  @IsIn(['admin', 'manager'])
  role?: 'admin' | 'manager'

  /** Optional password reset — same rules as create. */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'пароль: минимум 8 символов' })
  @Matches(/\d/, { message: 'пароль: должна быть хотя бы одна цифра' })
  password?: string
}
