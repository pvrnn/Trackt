-- Sign-in now requires a verified email. Accounts created before that never got the chance to verify, so they are grandfathered in.
UPDATE "user" SET "email_verified" = true WHERE "email_verified" = false;
