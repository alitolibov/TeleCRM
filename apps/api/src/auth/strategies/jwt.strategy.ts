import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { UsersService } from '../../users/users.service'

interface JwtPayload {
  sub: string
  role: 'admin' | 'manager'
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    })
  }

  /**
   * Per-request: validate the token's subject still maps to a live user.
   * Without this check, a JWT signed before the admin soft-deleted the user
   * would remain valid until expiry — letting deleted accounts keep using
   * the app for up to 8 hours.
   */
  async validate(payload: JwtPayload) {
    const user = await this.users.findById(payload.sub)
    if (!user || user.deletedAt) throw new UnauthorizedException('user no longer exists')
    return { id: user.id, role: user.role }
  }
}
