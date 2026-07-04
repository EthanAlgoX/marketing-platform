import { CanActivate, ExecutionContext, Injectable, BadRequestException } from "@nestjs/common";
import { USER_ID_HEADER } from "./access";

@Injectable()
export class RequireUserIdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest() as {
      headers?: Record<string, string | string[] | undefined>;
      userId?: string;
    };
    const userId = request.headers?.[USER_ID_HEADER] as string | undefined;

    if (!userId || userId.trim().length === 0) {
      throw new BadRequestException("x-user-id is required");
    }

    request.userId = userId;
    return true;
  }
}
