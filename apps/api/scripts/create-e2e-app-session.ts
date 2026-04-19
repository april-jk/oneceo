import '../src/config/env';

import { appUserDAO } from '../src/db/dao';
import { appAuthService } from '../src/services/app-auth-service';
import { hashPassword } from '../src/utils/auth-password';

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function main() {
  const email = asText(process.env.ONECEO_E2E_USER_EMAIL) || `oneceo-e2e-${Date.now()}@example.com`;
  const password = asText(process.env.ONECEO_E2E_USER_PASSWORD) || 'OneceoE2E!234';
  const displayName = asText(process.env.ONECEO_E2E_USER_DISPLAY_NAME) || 'OneCEO E2E';

  let user = await appUserDAO.getByEmail(email);
  if (!user) {
    user = await appUserDAO.create({
      email,
      passwordHash: await hashPassword(password),
      displayName,
    });
  } else {
    user =
      (await appUserDAO.updateById(String(user.id), {
        passwordHash: await hashPassword(password),
        displayName,
        status: 'active',
      })) || user;
  }

  const session = await appAuthService.createSessionForUser(String(user.id));
  console.log(
    JSON.stringify({
      ok: true,
      email,
      userId: String(user.id),
      sessionToken: session.token,
      cookieHeader: `app_session_id=${session.token}`,
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
