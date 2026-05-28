import { membershipService } from './membership-service';
import type { MembershipDbExecutor } from './membership-service';

export type NewAppUserBootstrapSource =
  | 'email_register'
  | 'oauth_google_register'
  | 'oauth_github_register';

class AppUserBootstrapService {
  async bootstrapNewAppUser(
    userId: string,
    _source: NewAppUserBootstrapSource,
    executor?: MembershipDbExecutor
  ) {
    return membershipService.assignDefaultMembershipForNewUser(userId, executor);
  }
}

export const appUserBootstrapService = new AppUserBootstrapService();
