import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Socket } from 'socket.io';
import { ThrottleService } from './throttle.service';
import { RATE_LIMITS } from './throttle.constants';

@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly logger = new Logger(ThrottleGuard.name);

  constructor(private readonly throttle: ThrottleService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<'http' | 'ws'>() === 'ws') {
      return this.canActivateWs(context);
    }

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const ip = req.ip;
    const userId = req.user?.id;
    const identifier = userId ?? ip;

    await this.throttle.checkBan(identifier);

    const isAuthRoute = req.path.includes('/auth');
    const config = isAuthRoute ? RATE_LIMITS.AUTH : RATE_LIMITS.GLOBAL;

    const key = `rate:${req.path}:${identifier}`;

    const { current, limit, ttl } = await this.throttle.checkRateLimit(
      key,
      config.limit,
      config.window,
    );

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
    res.setHeader('X-RateLimit-Reset', ttl);

    if (current > limit) {
      await this.throttle.registerViolation(identifier);
      throw new HttpException(
        'Rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Enforce the same limiter for WebSocket messages.
   *
   * HTTP guards never run for gateway events, so without this branch socket
   * clients could bypass the rate limiter entirely by sending messages over
   * an open connection. The identifier is the authenticated user when one is
   * available, falling back to the socket's remote address.
   */
  private async canActivateWs(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();
    const userId =
      client?.data?.user?.sub ??
      client?.data?.user?.userId ??
      client?.handshake?.auth?.userId;
    const identifier = userId ?? client?.handshake?.address ?? client?.id;

    if (!identifier) {
      return true;
    }

    const config = RATE_LIMITS.WEBSOCKET;
    const key = `rate:ws:${identifier}`;

    try {
      await this.throttle.checkBan(`ws:${identifier}`);

      const { current, limit, ttl } = await this.throttle.checkRateLimit(
        key,
        config.limit,
        config.window,
      );

      if (current > limit) {
        await this.throttle.registerViolation(`ws:${identifier}`);
        client?.emit('rate:limit', {
          message: 'Rate limit exceeded',
          limit,
          remaining: 0,
          resetAt: Date.now() + ttl * 1000,
        });
        return false;
      }
    } catch (error) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        client?.emit('rate:limit', {
          message: error.message,
          limit: config.limit,
          remaining: 0,
          resetAt: Date.now() + config.window * 1000,
        });
        return false;
      }

      // Fail open on infrastructure errors (e.g. Redis unavailable) so a
      // throttling outage does not take the socket layer down with it.
      this.logger.warn(
        `WebSocket rate limit check failed for ${identifier}: ${(error as Error).message}`,
      );
    }

    return true;
  }
}
